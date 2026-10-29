import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  autoLayoutTopology,
  mergeGeneratedTopology,
  normalizeTopology,
  renderTopologySvg,
} from "../../../shared/topology.js";
import { canonicalJson, hashContent } from "../src/technical-scope/hash.js";
import {
  computeScopeContentHash,
  technicalSectionSchema,
} from "../src/technical-scope/section-model.js";
import {
  blocksToDoc,
  buildTopologyNodes,
  docToBlocks,
  ensureSectionContent,
  injectScopeSectionsIntoContent,
  normalizeSectionWrite,
  sanitizeSectionDoc,
  sectionToProposalSection,
} from "../src/technical-scope/tiptap.js";
import { maskSecrets, maskTopologyLabels } from "../src/technical-scope/secrets.js";
import { parseNginxConfig } from "../src/technical-scope/parsers/nginx.js";
import {
  parseBindConfig,
  parseDhcpdConfig,
} from "../src/technical-scope/parsers/dns.js";
import {
  extractMxGraphXml,
  parseDrawioTopology,
} from "../src/technical-scope/parsers/drawio.js";
import {
  isEmptyAnswerValue,
  normalizeAnswerValue,
} from "../src/technical-scope/profile.js";
import { SEED_PLAYBOOKS } from "../src/technical-scope/seeds/playbooks.js";
import {
  parsePlaybookContent,
  playbookContentSchema,
} from "../src/technical-scope/playbook-schema.js";
import { detectPlaybooksFromText } from "../src/technical-scope/playbooks.js";
import {
  evaluateCondition,
  verifyTechnicalScope,
} from "../src/technical-scope/verifier.js";
import {
  buildDeterministicSections,
  formatAnswerValue,
} from "../src/technical-scope/generation.js";
import {
  analyzeTextDocument,
  candidatesFromFacts,
} from "../src/technical-scope/document-extraction.js";
import {
  buildBaselineTopology,
  linkTopologyToQuotation,
} from "../src/technical-scope/topology-generation.js";
import { containsCustomerData, mergeSeedRules } from "../src/technical-scope/playbook-draft.js";
import {
  inferRagDocTypeFromFileName,
  resolveRagDocType,
} from "../src/documentacion-rag/doc-types.js";
import { buildSowSections, computeSowHash } from "../src/technical-scope/sow-service.js";

const playbooks = SEED_PLAYBOOKS.map((seed) => ({
  id: 1,
  code: seed.code,
  name: seed.name,
  status: "borrador_ia",
  ragTopicName: seed.ragTopicName,
  detectionKeywords: seed.detectionKeywords,
  currentVersionNumber: 1,
  content: parsePlaybookContent(seed.content),
}));

const paragraph = (text) => ({ type: "paragraph", text, items: [], table: null });
const list = (items) => ({ type: "list", text: "", items, table: null });

describe("hash canonico", () => {
  it("no depende del orden de las llaves", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
    );
    expect(hashContent({ a: 1, b: 2 })).toBe(hashContent({ b: 2, a: 1 }));
  });

  it("el hash del alcance cambia con el contenido, la topologia y la version de cotizacion", () => {
    const base = {
      sections: [{ code: "a", title: "A", blocks: [paragraph("hola")] }],
      topology: null,
      asisTopology: null,
      quotationVersionId: 10,
      snapshotAnswers: [{ playbookCode: "p", questionCode: "q", value: 1 }],
    };
    const original = computeScopeContentHash(base);
    expect(computeScopeContentHash({ ...base })).toBe(original);
    expect(
      computeScopeContentHash({
        ...base,
        sections: [{ code: "a", title: "A", blocks: [paragraph("hola!")] }],
      }),
    ).not.toBe(original);
    expect(computeScopeContentHash({ ...base, quotationVersionId: 11 })).not.toBe(original);
    expect(
      computeScopeContentHash({
        ...base,
        topology: { nodes: [{ id: "x" }] },
      }),
    ).not.toBe(original);
    expect(
      computeScopeContentHash({
        ...base,
        snapshotAnswers: [{ playbookCode: "p", questionCode: "q", value: 2 }],
      }),
    ).not.toBe(original);
  });
});

describe("secciones tecnicas en el documento de propuesta", () => {
  const heading = (title) => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: title }] });
  const section = (title, body = "texto", attrs = { startOnNewPage: true }) => ({
    type: "proposalSection",
    attrs,
    content: [heading(title), { type: "paragraph", content: [{ type: "text", text: body }] }],
  });
  const technical = [sectionToProposalSection({ code: "scope_included", title: "Alcance incluido", blocks: [{ type: "paragraph", text: "aprobado" }] })];
  const titles = (content) =>
    content.document.content.map((node) => node.content?.[0]?.content?.[0]?.text);

  it("reemplaza la descripcion de la solucion conservando su salto de pagina", () => {
    const content = {
      schema_version: 3,
      document: {
        type: "doc",
        content: [section("Resumen Ejecutivo"), section("Descripción de la Solución", "generico"), section("Servicios")],
      },
    };
    const result = injectScopeSectionsIntoContent(content, technical);
    expect(titles(result)).toEqual(["Resumen Ejecutivo", "Alcance incluido", "Servicios"]);
    expect(JSON.stringify(result)).not.toContain("generico");
    expect(result.document.content[1].attrs.startOnNewPage).toBe(true);
    expect(JSON.stringify(content)).toContain("generico");
  });

  it("sin esa seccion se coloca antes de Servicios y, si no, al final", () => {
    const before = injectScopeSectionsIntoContent(
      { schema_version: 3, document: { type: "doc", content: [section("Resumen"), section("Servicios")] } },
      technical,
    );
    expect(titles(before)).toEqual(["Resumen", "Alcance incluido", "Servicios"]);
    const atEnd = injectScopeSectionsIntoContent(
      { schema_version: 3, document: { type: "doc", content: [section("Resumen")] } },
      technical,
    );
    expect(titles(atEnd)).toEqual(["Resumen", "Alcance incluido"]);
  });

  it("tambien reemplaza la seccion en documentos con el formato anterior", () => {
    const legacy = {
      schema_version: 2,
      sections: [
        { id: "a", source_code: "executive_summary", title: "Resumen", blocks: [] },
        { id: "b", source_code: "solution_description", title: "Descripcion", blocks: [{ type: "paragraph", text: "generico" }] },
      ],
    };
    const result = injectScopeSectionsIntoContent(legacy, technical);
    expect(result.sections.map((entry) => entry.title)).toEqual(["Resumen", "Alcance incluido"]);
    expect(JSON.stringify(result)).not.toContain("generico");
  });

  it("no cambia el contenido cuando no hay secciones tecnicas", () => {
    const content = { schema_version: 3, document: { type: "doc", content: [section("Resumen")] } };
    expect(injectScopeSectionsIntoContent(content, [])).toBe(content);
  });

  it("conserva las tablas como tablas y omite secciones vacias", () => {
    const parsed = technicalSectionSchema.parse({
      code: "phases",
      title: "Fases",
      blocks: [
        { type: "table", table: { headers: ["Fase", "Duracion"], rows: [["Diseno", "2 semanas"]] } },
      ],
    });
    const node = sectionToProposalSection(parsed);
    expect(node.content[0].attrs.level).toBe(2);
    expect(node.content[1].type).toBe("table");
    expect(JSON.stringify(node.content[1])).toContain("tableHeader");
    expect(JSON.stringify(node.content[1])).toContain("2 semanas");
    expect(sectionToProposalSection({ code: "x", title: "X", blocks: [] })).toBeNull();
  });

  it("dibuja la topologia como imagen con su leyenda y omite las vacias", () => {
    const topology = normalizeTopology({
      zones: [],
      nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      edges: [{ source: "a", target: "b" }],
    });
    const nodes = buildTopologyNodes(topology, "Topologia propuesta");
    expect(nodes[0].type).toBe("paragraph");
    expect(nodes[1].type).toBe("image");
    expect(nodes[1].attrs.src.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(buildTopologyNodes(null, "Vacia")).toEqual([]);
  });
});

describe("contenido enriquecido de las secciones", () => {
  const text = (value, marks) => ({ type: "text", text: value, ...(marks ? { marks } : {}) });

  it("conserva texto, listas, tablas y formato permitido, y descarta lo demas", () => {
    const doc = sanitizeSectionDoc({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [text("Titulo")] },
        { type: "paragraph", content: [text("Hola ", [{ type: "bold" }]), text("mundo", [{ type: "link", attrs: { href: "https://example.com" } }])] },
        { type: "paragraph", content: [text("peligro", [{ type: "link", attrs: { href: "javascript:alert(1)" } }, { type: "textStyle" }])] },
        { type: "paragraph" },
        { type: "image", attrs: { src: "data:image/png;base64,AAAA" } },
        { type: "proposalPageBreak" },
        { type: "proposalSection", content: [{ type: "paragraph", content: [text("dentro de una seccion")] }] },
        { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [text("uno")] }] }] },
      ],
    });
    expect(doc.content[0]).toEqual({ type: "heading", attrs: { level: 3 }, content: [text("Titulo")] });
    const serialized = JSON.stringify(doc);
    expect(serialized).toContain('"bold"');
    expect(serialized).toContain("https://example.com");
    expect(serialized).not.toMatch(/javascript:|image|PageBreak|proposalSection|textStyle|AAAA/);
    expect(serialized).toContain("dentro de una seccion");
    expect(doc.content.filter((node) => node.type === "paragraph" && !node.content)).toHaveLength(0);
    expect(doc.content.at(-1).type).toBe("orderedList");
  });

  it("deriva bloques del contenido y el contenido de los bloques, de forma estable", () => {
    const blocks = [
      { type: "paragraph", text: "Resumen", items: [], table: null },
      { type: "list", text: "", items: ["a", "b"], table: null },
      { type: "table", text: "", items: [], table: { headers: ["Fase", "Duracion"], rows: [["Diseno", "2 semanas"]] } },
    ];
    const doc = blocksToDoc(blocks);
    expect(doc.content.map((node) => node.type)).toEqual(["paragraph", "bulletList", "table"]);
    expect(docToBlocks(doc)).toEqual(blocks);
    expect(ensureSectionContent({ blocks })).toEqual(doc);
    expect(sanitizeSectionDoc(doc)).toEqual(doc);
  });

  it("una escritura con contenido recalcula los bloques y una con bloques recalcula el contenido", () => {
    const fromContent = normalizeSectionWrite({
      code: "x",
      title: "X",
      blocks: [{ type: "paragraph", text: "viejo", items: [], table: null }],
      content: { type: "doc", content: [{ type: "paragraph", content: [text("nuevo", [{ type: "bold" }])] }] },
    });
    expect(fromContent.blocks).toEqual([{ type: "paragraph", text: "nuevo", items: [], table: null }]);
    const fromBlocks = normalizeSectionWrite({
      code: "x",
      title: "X",
      blocks: [{ type: "paragraph", text: "solo bloques", items: [], table: null }],
      content: null,
    });
    expect(JSON.stringify(fromBlocks.content)).toContain("solo bloques");
  });

  it("el hash cubre el contenido enriquecido y es igual para bloques equivalentes", () => {
    const blocks = [{ type: "paragraph", text: "Texto", items: [], table: null }];
    const base = { topology: null, asisTopology: null, quotationVersionId: 1, snapshotAnswers: [] };
    const plain = computeScopeContentHash({ ...base, sections: [{ code: "a", title: "A", blocks }] });
    const withContent = computeScopeContentHash({ ...base, sections: [{ code: "a", title: "A", blocks, content: blocksToDoc(blocks) }] });
    expect(withContent).toBe(plain);
    const bold = { type: "doc", content: [{ type: "paragraph", content: [text("Texto", [{ type: "bold" }])] }] };
    expect(computeScopeContentHash({ ...base, sections: [{ code: "a", title: "A", blocks, content: bold }] })).not.toBe(plain);
  });
});

describe("topologia", () => {
  it("normaliza y descarta enlaces a nodos inexistentes", () => {
    const topology = normalizeTopology({
      nodes: [{ id: "a", label: "A" }, { id: "b", label: "B", kind: "desconocido" }],
      edges: [{ source: "a", target: "b" }, { source: "a", target: "zzz" }, { source: "a", target: "a" }],
    });
    expect(topology.nodes[1].kind).toBe("generic");
    expect(topology.edges).toHaveLength(1);
  });

  it("asigna coordenadas y encierra los nodos en su zona", () => {
    const topology = autoLayoutTopology({
      zones: [{ id: "z", label: "Sitio" }],
      nodes: [
        { id: "u", label: "Usuarios", kind: "user" },
        { id: "a", label: "App", zoneId: "z" },
        { id: "b", label: "BD", zoneId: "z" },
      ],
    });
    const zone = topology.zones[0];
    for (const node of topology.nodes.filter((entry) => entry.zoneId === "z")) {
      expect(node.x).toBeGreaterThanOrEqual(zone.x);
      expect(node.y).toBeGreaterThanOrEqual(zone.y);
      expect(node.x + node.w).toBeLessThanOrEqual(zone.x + zone.w);
      expect(node.y + node.h).toBeLessThanOrEqual(zone.y + zone.h);
    }
  });

  it("conserva los nodos bloqueados al regenerar y agrega solo los nuevos", () => {
    const current = autoLayoutTopology({
      nodes: [
        { id: "re", label: "Regional Edge", kind: "f5_xc_re", locked: true, x: 500, y: 300, w: 170, h: 58 },
        { id: "manual", label: "Mi nodo manual", locked: false },
      ],
    });
    const generated = {
      nodes: [
        { id: "x1", label: "Regional Edge", kind: "f5_xc_re" },
        { id: "x2", label: "Customer Edge", kind: "f5_xc_ce" },
      ],
      edges: [{ source: "x1", target: "x2", label: "Tunel" }],
    };
    const merged = mergeGeneratedTopology(current, generated);
    const re = merged.nodes.find((node) => node.id === "re");
    expect(re.x).toBe(500);
    expect(re.y).toBe(300);
    expect(merged.nodes.filter((node) => node.label === "Regional Edge")).toHaveLength(1);
    expect(merged.nodes.some((node) => node.label === "Customer Edge")).toBe(true);
    expect(merged.nodes.some((node) => node.label === "Mi nodo manual")).toBe(false);
    expect(merged.edges).toHaveLength(1);
    expect(merged.edges[0].source).toBe("re");
  });

  it("las coordenadas nulas no se convierten en cero y los nodos nuevos no se apilan", () => {
    const laidOut = autoLayoutTopology({
      nodes: [
        { id: "a", label: "A", x: null, y: null },
        { id: "b", label: "B", x: "", y: undefined },
      ],
    });
    expect(laidOut.nodes[0].y).not.toBe(laidOut.nodes[1].y);
    const merged = mergeGeneratedTopology(
      autoLayoutTopology({ nodes: [{ id: "l", label: "L", kind: "nginx", locked: true }] }),
      { nodes: [{ id: "n1", label: "N1" }, { id: "n2", label: "N2" }, { id: "n3", label: "N3" }] },
    );
    const positions = new Set(merged.nodes.map((node) => `${node.x},${node.y}`));
    expect(positions.size).toBe(merged.nodes.length);
    expect(merged.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true);
  });

  it("renderiza un SVG determinista con las etiquetas escapadas", () => {
    const topology = {
      nodes: [
        { id: "a", label: "Usuarios <&>", kind: "user" },
        { id: "b", label: "NGINX", kind: "nginx" },
      ],
      edges: [{ source: "a", target: "b", label: "HTTPS" }],
    };
    const first = renderTopologySvg(topology);
    const second = renderTopologySvg(topology);
    expect(first).toBe(second);
    expect(first.startsWith("<svg")).toBe(true);
    expect(first).toContain("Usuarios &lt;&amp;&gt;");
    expect(first).toContain("HTTPS");
    expect(first).not.toContain("<&>");
  });
});

describe("enmascaramiento de secretos", () => {
  it("enmascara credenciales, llaves y tokens", () => {
    const input = [
      'password: "hunter2"',
      "api_key=abcd1234efgh",
      "snmp-server community public RO",
      "enable secret 5 $1$abc$xyz",
      "Authorization: Bearer abcdefgh12345678",
      "url=https://bob:pw@host/x",
      "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----",
      "server_name app.example.com;",
    ].join("\n");
    const { text, redactions } = maskSecrets(input, { configLike: true });
    for (const secret of ["hunter2", "abcd1234efgh", "public", "$1$abc$xyz", "abcdefgh12345678", "bob:pw", "MIIE"]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain("server_name app.example.com;");
    expect(redactions.count).toBeGreaterThanOrEqual(6);
  });

  it("enmascara sintaxis de dispositivos de red y bloques PEM sin cerrar", () => {
    const input = [
      "tacacs-server host 10.1.1.1 key 7 0822455D0A16",
      "radius-server key MySecretKey123",
      "crypto isakmp key SuperSecret address 1.2.3.4",
      "set psk ENC AAAAencryptedblob",
      "pre-shared-key = abc123",
      "set password ENC SH2xxxxblob",
      "passwordHash: $2b$10$abcdefghijk",
      "proxy_cache_key $uri;",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA",
    ].join("\n");
    const { text } = maskSecrets(input, { configLike: true });
    for (const secret of ["0822455D0A16", "MySecretKey123", "SuperSecret", "AAAAencryptedblob", "abc123", "SH2xxxxblob", "$2b$10$abcdefghijk", "MIIEowIBAAKCAQEA"]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain("proxy_cache_key $uri;");
  });

  it("no se degrada con entradas maliciosas grandes", () => {
    const started = Date.now();
    maskSecrets("-----BEGIN A-----\n".repeat(30_000), { configLike: true });
    parseNginxConfig("listen ".repeat(60_000));
    parseNginxConfig("upstream a {".repeat(30_000));
    parseBindConfig('zone "a" { '.repeat(30_000));
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("enmascara las etiquetas de una topologia", () => {
    const masked = maskTopologyLabels({
      title: "",
      zones: [{ label: "Sitio" }],
      nodes: [{ label: "Firewall password: hunter2", sublabel: "ok" }],
      edges: [{ label: "token=abcdef123456" }],
    });
    expect(JSON.stringify(masked)).not.toMatch(/hunter2|abcdef123456/);
  });

  it("no altera la prosa cuando no es una configuracion", () => {
    const { text } = maskSecrets("The community of users has a secret garden", { configLike: false });
    expect(text).toBe("The community of users has a secret garden");
  });
});

describe("analizadores de configuracion", () => {
  it("cuenta aplicaciones y detecta funciones de NGINX", () => {
    const facts = parseNginxConfig(`
      # comentario
      upstream api { server 10.0.0.1:8080; server 10.0.0.2:8080; }
      server { listen 443 ssl; server_name app.cliente.com www.cliente.com; limit_req zone=z; location / { proxy_pass http://api; } }
      server { listen 80; server_name api.cliente.com; proxy_cache zone; auth_jwt "x"; health_check; }
    `);
    expect(facts.metrics.server_blocks).toBe(2);
    expect(facts.metrics.distinct_server_names).toBe(3);
    expect(facts.metrics.upstreams).toBe(1);
    expect(facts.metrics.upstream_servers).toBe(2);
    expect(facts.features).toEqual(
      expect.arrayContaining(["load_balancing", "rate_limit", "cache", "auth", "active_health_checks"]),
    );
  });

  it("cuenta zonas de BIND y subredes de DHCP", () => {
    const bind = parseBindConfig(`
      zone "cliente.com" IN { type master; file "a"; };
      zone "interna.local" { type slave; masters { 1.1.1.1; }; };
      zone "." { type forward; };
    `);
    expect(bind.metrics.zones).toBe(3);
    expect(bind.metrics.primary_zones).toBe(1);
    expect(bind.metrics.secondary_zones).toBe(1);
    const dhcp = parseDhcpdConfig(`
      subnet 10.0.0.0 netmask 255.255.255.0 { range 10.0.0.10 10.0.0.50; }
      subnet 10.0.1.0 netmask 255.255.255.0 { }
      host pc1 { hardware ethernet 00:11; }
    `);
    expect(dhcp.metrics.subnets).toBe(2);
    expect(dhcp.metrics.reservations).toBe(1);
  });

  it("lee diagramas drawio en XML plano y comprimido", () => {
    const xml = `<mxGraphModel><root>
      <mxCell id="0"/><mxCell id="1" parent="0"/>
      <mxCell id="z1" value="Sitio principal" style="swimlane;" vertex="1" parent="1"><mxGeometry x="10" y="10" width="400" height="300" as="geometry"/></mxCell>
      <mxCell id="n1" value="Servidor NGINX" style="rounded=1;" vertex="1" parent="z1"><mxGeometry x="20" y="40" width="120" height="50" as="geometry"/></mxCell>
      <mxCell id="n2" value="Aplicaci&#243;n" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="600" y="40" width="120" height="50" as="geometry"/></mxCell>
      <mxCell id="e1" value="HTTPS" edge="1" source="n1" target="n2" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>
    </root></mxGraphModel>`;
    const plain = parseDrawioTopology(`<mxfile><diagram name="x">${xml}</diagram></mxfile>`);
    expect(plain.zones).toHaveLength(1);
    expect(plain.nodes.map((node) => node.kind)).toEqual(expect.arrayContaining(["nginx"]));
    expect(plain.nodes.find((node) => node.label === "Servidor NGINX").zoneId).toBe(plain.zones[0].id);
    expect(plain.edges).toHaveLength(1);

    const compressed = deflateRawSync(Buffer.from(encodeURIComponent(xml))).toString("base64");
    const fromCompressed = parseDrawioTopology(`<mxfile><diagram>${compressed}</diagram></mxfile>`);
    expect(extractMxGraphXml(`<mxfile><diagram>${compressed}</diagram></mxfile>`)).toContain("mxGraphModel");
    expect(fromCompressed.nodes).toHaveLength(plain.nodes.length);
    expect(parseDrawioTopology("<nada/>")).toBeNull();
  });
});

describe("respuestas del cuestionario", () => {
  const number = { code: "n", type: "number", options: [] };
  const choice = { code: "c", type: "choice", options: ["A", "B"] };
  const multi = { code: "m", type: "multi", options: ["A", "B", "C"] };
  const bool = { code: "b", type: "boolean", options: [] };

  it("valida y normaliza por tipo", () => {
    expect(normalizeAnswerValue(number, "1,200")).toBe(1200);
    expect(normalizeAnswerValue(bool, "Sí")).toBe(true);
    expect(normalizeAnswerValue(bool, "no")).toBe(false);
    expect(normalizeAnswerValue(choice, "A")).toBe("A");
    expect(normalizeAnswerValue(multi, ["A", "A", "B"])).toEqual(["A", "B"]);
    expect(normalizeAnswerValue(number, "")).toBeNull();
    expect(() => normalizeAnswerValue(number, "mucho")).toThrow();
    expect(() => normalizeAnswerValue(choice, "Z")).toThrow();
    expect(() => normalizeAnswerValue(multi, ["A", "Z"])).toThrow();
    expect(isEmptyAnswerValue([])).toBe(true);
    expect(isEmptyAnswerValue(0)).toBe(false);
  });

  it("da formato legible a los valores", () => {
    expect(formatAnswerValue({ value: true })).toBe("Sí");
    expect(formatAnswerValue({ value: 5, unit: "sitios" })).toBe("5 sitios");
    expect(formatAnswerValue({ value: ["A", "B"] })).toBe("A, B");
  });
});

describe("playbooks semilla", () => {
  it("las seis soluciones prioritarias son validas", () => {
    expect(SEED_PLAYBOOKS.map((seed) => seed.code)).toEqual([
      "f5_dcs",
      "f5_nginx",
      "bluecat_micetro",
      "bluecat_edge",
      "bluecat_integrity",
      "bluecat_observability",
    ]);
    for (const playbook of playbooks) {
      expect(playbook.content.questions.length).toBeGreaterThan(5);
      expect(playbook.content.topologyTemplates.length).toBeGreaterThan(0);
      expect(playbook.content.scope.included.length).toBeGreaterThan(3);
      expect(containsCustomerData(playbook.content)).toBe(false);
    }
  });

  it("observabilidad cubre LiveNX, LiveWire y LiveAssist", () => {
    const observability = playbooks.find((entry) => entry.code === "bluecat_observability");
    expect(observability.content.modules.map((module) => module.code)).toEqual([
      "livenx",
      "livewire",
      "liveassist",
    ]);
    expect(observability.content.dependencies[0].severity).toBe("blocking");
  });

  it("rechaza preguntas repetidas, modulos y condiciones inexistentes", () => {
    const invalid = playbookContentSchema.safeParse({
      modules: [],
      questions: [
        { code: "q1", prompt: "Pregunta uno", type: "text" },
        { code: "q1", prompt: "Pregunta repetida", type: "text" },
        { code: "q2", module: "inexistente", prompt: "Pregunta dos", type: "text" },
        { code: "q3", prompt: "Opcion sin opciones", type: "choice" },
      ],
      expectations: [
        { code: "e1", when: { question: "nada", op: "truthy" }, expectProduct: "x", message: "mensaje" },
      ],
    });
    expect(invalid.success).toBe(false);
    const messages = invalid.error.issues.map((issue) => issue.message).join(" | ");
    expect(messages).toContain("Pregunta repetida");
    expect(messages).toContain("Modulo inexistente");
    expect(messages).toContain("opciones");
    expect(messages).toContain("pregunta inexistente");
  });

  it("detecta playbooks y modulos desde las partidas cotizadas", () => {
    const matches = detectPlaybooksFromText(
      playbooks,
      "Oportunidad WAF | F5 Distributed Cloud Bot Defense | BlueCat LiveNX y LiveAssist | Micetro",
    );
    const codes = matches.map((match) => match.code);
    expect(codes).toEqual(expect.arrayContaining(["f5_dcs", "bluecat_observability", "bluecat_micetro"]));
    expect(matches.find((match) => match.code === "f5_dcs").modules).toEqual(
      expect.arrayContaining(["bot_defense"]),
    );
    expect(matches.find((match) => match.code === "bluecat_observability").modules).toEqual(
      expect.arrayContaining(["livenx", "liveassist"]),
    );
    expect(matches.find((match) => match.code === "bluecat_micetro").modules).toEqual(["micetro"]);
    expect(detectPlaybooksFromText(playbooks, "Servidores y switches")).toEqual([]);
  });
});

describe("verificador", () => {
  const items = [
    { productCode: "LNX-1", productDescription: "BlueCat LiveAssist subscription", groupTitle: "IA" },
    { productCode: "WAF-1", productDescription: "F5 Distributed Cloud WAAP", groupTitle: "Seguridad" },
  ];
  const fullSections = (extra = {}) => [
    { code: "proposed_solution", title: "Solucion", blocks: [paragraph("x")], itemRefs: ["LNX-1", "WAF-1"], sources: [{ kind: "quotation", ref: "LNX-1", label: "" }], edited: true },
    { code: "scope_included", title: "Alcance", blocks: [list(["a"])], itemRefs: [], sources: [], edited: true },
    { code: "scope_excluded", title: "Exclusiones", blocks: [list(["b"])], itemRefs: [], sources: [], edited: true },
    { code: "assumptions", title: "Supuestos", blocks: [list(["c"])], itemRefs: [], sources: [], edited: true },
    ...(extra.more || []),
  ];
  const observabilitySelection = [{ code: "bluecat_observability", modules: ["livenx", "liveassist"] }];

  it("bloquea LiveAssist sin LiveNX cotizado ni instalado", () => {
    const result = verifyTechnicalScope({
      sections: fullSections(),
      topology: null,
      snapshot: { answers: [{ playbookCode: "bluecat_observability", questionCode: "livenx_installed", value: "No" }], missing: [] },
      selections: observabilitySelection,
      playbooks,
      quotationItems: items,
    });
    expect(result.findings.some((finding) => finding.code === "liveassist_requires_livenx" && finding.severity === "blocking")).toBe(true);
    expect(result.blocking).toBeGreaterThan(0);
  });

  it("no bloquea cuando el cliente ya tiene LiveNX instalado", () => {
    const result = verifyTechnicalScope({
      sections: fullSections(),
      topology: null,
      snapshot: { answers: [{ playbookCode: "bluecat_observability", questionCode: "livenx_installed", value: "Sí, ya instalado" }], missing: [] },
      selections: observabilitySelection,
      playbooks,
      quotationItems: items,
    });
    expect(result.findings.some((finding) => finding.code === "liveassist_requires_livenx")).toBe(false);
  });

  it("detecta referencias a productos inexistentes y partidas sin cubrir", () => {
    const sections = fullSections();
    sections[0].itemRefs = ["WAF-1", "FANTASMA"];
    const result = verifyTechnicalScope({
      sections,
      topology: null,
      snapshot: { answers: [], missing: [] },
      selections: [],
      playbooks,
      quotationItems: items,
    });
    const codes = result.findings.map((finding) => finding.code);
    expect(codes).toContain("unknown_item_ref");
    expect(codes).toContain("item_not_covered");
    expect(result.findings.find((finding) => finding.code === "unknown_item_ref").severity).toBe("blocking");
  });

  it("sin cotizacion las referencias a productos no bloquean", () => {
    const sections = fullSections();
    sections[0].itemRefs = ["f5_dcs"];
    const result = verifyTechnicalScope({
      sections,
      topology: normalizeTopology({ zones: [], nodes: [{ id: "a", label: "A", itemRef: "XYZ" }], edges: [] }),
      snapshot: { answers: [], missing: [] },
      selections: [],
      playbooks,
      quotationItems: [],
    });
    const codes = result.findings.map((finding) => finding.code);
    expect(codes).not.toContain("unknown_item_ref");
    expect(codes).not.toContain("topology_unknown_item");
    expect(result.blocking).toBe(0);
  });

  it("exige las secciones obligatorias y bloquea informacion comercial interna", () => {
    const sections = [
      { code: "proposed_solution", title: "Solucion", blocks: [paragraph("El margen de utilidad es del 30%")], itemRefs: [], sources: [], edited: true },
    ];
    const result = verifyTechnicalScope({
      sections,
      topology: null,
      snapshot: { answers: [], missing: [] },
      selections: [],
      playbooks,
      quotationItems: [],
    });
    const codes = result.findings.map((finding) => finding.code);
    expect(codes.filter((code) => code === "section_missing")).toHaveLength(3);
    expect(codes).toContain("internal_information");
  });

  it("no confunde un margen tecnico con informacion comercial interna", () => {
    const sections = fullSections();
    sections[1].blocks = [paragraph("Dimensionar con margen para picos y resiliencia")];
    const result = verifyTechnicalScope({
      sections,
      topology: null,
      snapshot: { answers: [], missing: [] },
      selections: [],
      playbooks,
      quotationItems: items,
    });
    expect(result.findings.some((finding) => finding.code === "internal_information")).toBe(false);
  });

  it("aplica las expectativas del playbook segun las respuestas", () => {
    const result = verifyTechnicalScope({
      sections: fullSections(),
      topology: null,
      snapshot: { answers: [{ playbookCode: "f5_dcs", questionCode: "ce_sites", value: 2 }], missing: [{ playbookCode: "f5_dcs", questionCode: "apps_count", prompt: "Apps", required: true }] },
      selections: [{ code: "f5_dcs", modules: ["waap", "multicloud_connect"] }],
      playbooks,
      quotationItems: [items[1]],
    });
    const codes = result.findings.map((finding) => finding.code);
    expect(codes).toContain("ce_sites_need_ce");
    expect(codes).toContain("required_answer_missing");
  });

  it("evalua condiciones", () => {
    const values = new Map([["n", 3], ["t", ["A", "B"]], ["z", ""], ["f", false]]);
    expect(evaluateCondition({ question: "n", op: "gt", value: 2 }, values)).toBe(true);
    expect(evaluateCondition({ question: "n", op: "lt", value: 2 }, values)).toBe(false);
    expect(evaluateCondition({ question: "t", op: "eq", value: "a" }, values)).toBe(true);
    expect(evaluateCondition({ question: "z", op: "truthy" }, values)).toBe(false);
    expect(evaluateCondition({ question: "f", op: "truthy" }, values)).toBe(false);
    expect(evaluateCondition({ question: "n", op: "truthy" }, values)).toBe(true);
  });
});

describe("generacion base y SOW", () => {
  const snapshot = {
    answers: [
      { playbookCode: "f5_dcs", questionCode: "apps_count", prompt: "Aplicaciones", type: "number", unit: "apps", value: 12 },
      { playbookCode: "f5_dcs", questionCode: "app_locations", prompt: "Orígenes", type: "multi", value: ["AWS", "Azure"] },
    ],
    missing: [{ playbookCode: "f5_dcs", questionCode: "dns_control", prompt: "Control DNS", required: true }],
  };
  const quotationItems = [
    { groupTitle: "Seguridad", inclusionCode: "incluida", productCode: "WAF-1", productDescription: "F5 Distributed Cloud WAAP", quantity: 1 },
  ];
  const selections = [{ code: "f5_dcs", modules: ["waap"] }];

  it("arma todas las secciones desde playbook, respuestas y cotizacion", () => {
    const sections = buildDeterministicSections({ selections, playbooks, snapshot, quotationItems });
    expect(sections.map((section) => section.code)).toEqual([
      "requirements", "current_situation", "proposed_solution", "architecture",
      "scope_included", "scope_excluded", "assumptions", "deliverables", "phases",
      "acceptance", "support_sla", "risks",
    ]);
    const solution = sections.find((section) => section.code === "proposed_solution");
    expect(solution.itemRefs).toEqual(["WAF-1"]);
    const assumptions = JSON.stringify(sections.find((section) => section.code === "assumptions"));
    expect(assumptions).toContain("Control DNS");
    const requirements = JSON.stringify(sections.find((section) => section.code === "requirements"));
    expect(requirements).toContain("Aplicaciones: 12 apps");
    expect(requirements).toContain("AWS, Azure");
    expect(JSON.stringify(sections)).not.toMatch(/precio|margen|costo/i);
  });

  it("deriva el SOW del alcance y toma las condiciones del dato comercial", () => {
    const scopeSections = buildDeterministicSections({ selections, playbooks, snapshot, quotationItems });
    const scope = { sections: scopeSections };
    const sow = buildSowSections({
      scope,
      proposal: { title: "Proyecto WAF", account_name: "Cliente SA" },
      terms: { payment_terms: "30 dias", delivery_time: "4 semanas", warranty_term: "1 año" },
    });
    expect(sow.map((section) => section.code)).toEqual([
      "sow_objective", "sow_scope", "sow_exclusions", "sow_architecture", "sow_deliverables",
      "sow_activities", "sow_roles", "sow_assumptions", "sow_acceptance", "sow_change_control",
      "sow_support", "sow_commercial",
    ]);
    expect(JSON.stringify(sow.find((section) => section.code === "sow_commercial"))).toContain("30 dias");
    expect(JSON.stringify(sow.find((section) => section.code === "sow_objective"))).toContain("Cliente SA");
    expect(computeSowHash(sow, "h1")).not.toBe(computeSowHash(sow, "h2"));
    expect(computeSowHash(sow, "h1")).toBe(computeSowHash(JSON.parse(JSON.stringify(sow)), "h1"));
  });

  it("prepara respuestas candidatas desde los hechos de una configuracion", () => {
    const nginx = analyzeTextDocument("server { listen 80; server_name a.com b.com; location / { proxy_pass http://x; } } upstream x { server 1.1.1.1; }");
    const candidates = candidatesFromFacts(nginx);
    expect(candidates.find((candidate) => candidate.playbookCode === "f5_dcs" && candidate.questionCode === "apps_count").value).toBe(2);
    const bind = candidatesFromFacts(analyzeTextDocument('zone "a.com" { type master; }; zone "b.com" { type master; };'));
    expect(bind.filter((candidate) => candidate.questionCode === "zones_count").map((candidate) => candidate.playbookCode).sort()).toEqual(["bluecat_integrity", "bluecat_micetro"]);
    expect(analyzeTextDocument("texto libre sin configuracion")).toBeNull();
  });

  it("combina plantillas de topologia y las enlaza con las partidas", () => {
    const baseline = buildBaselineTopology({
      selections: [{ code: "f5_dcs", modules: ["waap"] }],
      playbooks,
      snapshot: { answers: [{ playbookCode: "f5_dcs", questionCode: "ce_sites", value: 2 }] },
    });
    expect(baseline.nodes.some((node) => node.kind === "f5_xc_ce")).toBe(true);
    expect(baseline.nodes.every((node) => node.id.startsWith("f5_dcs__"))).toBe(true);
    const linked = linkTopologyToQuotation(baseline, [
      { productCode: "CE-1", productDescription: "F5 Distributed Cloud Customer Edge" },
    ]);
    expect(linked.nodes.find((node) => node.kind === "f5_xc_ce").itemRef).toBe("CE-1");
  });
});

describe("RAG por solucion", () => {
  it("resuelve el tipo de documento por codigo, etiqueta o nombre de archivo", () => {
    expect(resolveRagDocType("questionnaire")).toBe("questionnaire");
    expect(resolveRagDocType("Guía de diseño")).toBe("design_guide");
    expect(resolveRagDocType("arquitectura")).toBe("reference_architecture");
    expect(resolveRagDocType("desconocido")).toBeNull();
    expect(inferRagDocTypeFromFileName("[Cuestionario] F5 XC WAAP - levantamiento.docx")).toBe("questionnaire");
    expect(inferRagDocTypeFromFileName("[Configuración] nginx.conf.txt")).toBe("sample_config");
    expect(inferRagDocTypeFromFileName("sin etiqueta.pdf")).toBeNull();
  });

  it("las reglas de los playbooks semilla sobreviven a un borrador de IA con sus preguntas", () => {
    const drafted = parsePlaybookContent({
      modules: [{ code: "livenx", name: "LiveNX" }, { code: "liveassist", name: "LiveAssist" }],
      questions: [{ code: "n1", module: "general", prompt: "Pregunta nueva", type: "text" }],
      dependencies: [
        { code: "liveassist_requires_livenx", ifProduct: "liveassist", requireProduct: "livenx", message: "Regla de IA", severity: "warning" },
      ],
    });
    const merged = mergeSeedRules(drafted, "bluecat_observability");
    const rule = merged.dependencies.find((entry) => entry.code === "liveassist_requires_livenx");
    expect(rule.severity).toBe("blocking");
    expect(rule.unless.question).toBe("livenx_installed");
    expect(merged.questions.some((question) => question.code === "livenx_installed")).toBe(true);
    expect(() => parsePlaybookContent(merged)).not.toThrow();
    // Rules whose module no longer exists are dropped instead of leaving dangling references.
    const withoutModule = mergeSeedRules(
      parsePlaybookContent({ modules: [{ code: "other", name: "Otro" }], questions: [] }),
      "f5_nginx",
    );
    expect(() => parsePlaybookContent(withoutModule)).not.toThrow();
    expect(mergeSeedRules(drafted, "inexistente")).toBe(drafted);
  });

  it("detecta datos de cliente en un borrador de playbook", () => {
    expect(containsCustomerData({ a: "conectar a 10.20.30.40" })).toBe(true);
    expect(containsCustomerData({ a: "contacto juan@cliente.com" })).toBe(true);
    expect(containsCustomerData({ a: "version 12.4" })).toBe(false);
  });
});
