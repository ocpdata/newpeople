import { Buffer } from "node:buffer";
import path from "node:path";
import { z } from "zod";
import { query } from "../db.js";
import {
  getDocumentContentStream,
  listOpportunityDocuments,
} from "../opportunity-documents/service.js";
import { normalizeTopology } from "../../../../shared/topology.js";
import { TECHNICAL_SCOPE_AI_FEATURES, requestAiJson } from "./ai.js";
import { parseJsonSafe } from "./hash.js";
import { parseDrawioTopology } from "./parsers/drawio.js";
import {
  looksLikeBindConfig,
  looksLikeDhcpdConfig,
  parseBindConfig,
  parseDhcpdConfig,
} from "./parsers/dns.js";
import { looksLikeNginxConfig, parseNginxConfig } from "./parsers/nginx.js";
import { questionsForSelection, saveSuggestedAnswer } from "./profile.js";
import { maskSecrets, maskTopologyLabels } from "./secrets.js";

const CONFIG_EXTENSIONS = new Set([".conf", ".cfg", ".yaml", ".yml", ".json", ".xml", ".tf"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);
const MAX_AI_TEXT_CHARS = 30_000;
const MAX_DOCUMENTS_PER_RUN = 8;
const MIN_AI_CONFIDENCE = 0.4;

const NGINX_FEATURE_OPTIONS = {
  load_balancing: "Balanceo de carga L7",
  rate_limit: "Límite de tasa",
  cache: "Caché de contenido",
  auth: "Autenticación JWT / OIDC",
  active_health_checks: "Health checks activos",
  session_persistence: "Persistencia de sesión",
};

// Maps deterministic facts to candidate questionnaire answers.
export function candidatesFromFacts(facts) {
  const candidates = [];
  if (!facts) return candidates;
  if (facts.kind === "nginx_config") {
    const names = facts.metrics.distinct_server_names;
    if (names > 0) {
      candidates.push({
        playbookCode: "f5_dcs",
        questionCode: "apps_count",
        value: names,
        confidence: 0.6,
        evidence: `${names} nombres de servidor distintos en la configuración`,
      });
    }
    const plusFeatures = (facts.features || [])
      .map((feature) => NGINX_FEATURE_OPTIONS[feature])
      .filter(Boolean);
    if (plusFeatures.length) {
      candidates.push({
        playbookCode: "f5_nginx",
        questionCode: "plus_features",
        value: plusFeatures,
        confidence: 0.7,
        evidence: "Directivas detectadas en la configuración de NGINX",
      });
    }
    if ((facts.features || []).includes("app_protect")) {
      candidates.push({
        playbookCode: "f5_nginx",
        questionCode: "app_protect_modules",
        value: ["WAF"],
        confidence: 0.7,
        evidence: "Directivas de App Protect en la configuración",
      });
    }
  }
  if (facts.kind === "bind_config" && facts.metrics.zones > 0) {
    for (const playbookCode of ["bluecat_micetro", "bluecat_integrity"]) {
      candidates.push({
        playbookCode,
        questionCode: "zones_count",
        value: facts.metrics.zones,
        confidence: 0.85,
        evidence: `${facts.metrics.zones} zonas en la configuración de BIND`,
      });
    }
    if ((facts.features || []).includes("dnssec")) {
      candidates.push({
        playbookCode: "bluecat_integrity",
        questionCode: "dnssec",
        value: true,
        confidence: 0.6,
        evidence: "Directivas de DNSSEC en la configuración",
      });
    }
  }
  if (facts.kind === "dhcpd_config" && facts.metrics.subnets > 0) {
    candidates.push({
      playbookCode: "bluecat_micetro",
      questionCode: "subnets_count",
      value: facts.metrics.subnets,
      confidence: 0.85,
      evidence: `${facts.metrics.subnets} subredes en la configuración de DHCP`,
    });
  }
  return candidates;
}

export function analyzeTextDocument(text) {
  if (looksLikeNginxConfig(text)) return parseNginxConfig(text);
  if (looksLikeBindConfig(text)) return parseBindConfig(text);
  if (looksLikeDhcpdConfig(text)) return parseDhcpdConfig(text);
  return null;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

const MAX_AI_ANSWERS = 80;

const aiAnswerSchema = z.object({
  playbookCode: z.string().trim().max(80),
  questionCode: z.string().trim().max(120),
  value: z.preprocess(
    (value) =>
      Array.isArray(value)
        ? value.filter((item) => item !== null && item !== undefined).map((item) => String(item))
        : value,
    z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
  ),
  confidence: z.preprocess(
    (value) => (typeof value === "string" && value.trim() !== "" ? Number(value) : value),
    z.number().min(0).max(1),
  ).catch(0.5),
  evidence: z.preprocess((value) => (typeof value === "string" ? value.slice(0, 400) : ""), z.string().trim()),
});

// The model may return malformed entries (null values, nested objects); those are dropped instead of failing the whole document.
const aiAnswersSchema = z.object({
  detectedKind: z.string().trim().max(60).optional().default("unknown").catch("unknown"),
  summary: z.preprocess((value) => (typeof value === "string" ? value.slice(0, 600) : ""), z.string().trim()),
  answers: z
    .array(z.unknown())
    .default([])
    .catch([])
    .transform((items) =>
      items
        .map((item) => aiAnswerSchema.safeParse(item))
        .filter((parsed) => parsed.success)
        .map((parsed) => parsed.data)
        .slice(0, MAX_AI_ANSWERS),
    ),
});

const aiDiagramSchema = z.object({
  title: z.string().trim().max(120).optional().default(""),
  zones: z.array(z.any()).max(30).optional().default([]),
  nodes: z.array(z.any()).max(120).optional().default([]),
  edges: z.array(z.any()).max(240).optional().default([]),
  notes: z.string().trim().max(600).optional().default(""),
});

const EXTRACTION_SYSTEM_PROMPT =
  "Eres un ingeniero preventa que extrae datos tecnicos de documentos del cliente para llenar un cuestionario. Responde exclusivamente con JSON valido. Extrae SOLO informacion explicita en el documento; si un dato no aparece, no lo incluyas. No infieras cifras. Para cada respuesta incluye la pregunta (playbookCode y questionCode exactos de la lista), el valor con el tipo pedido (numero, boolean, texto, o lista de opciones EXACTAS para tipo multi; una opcion exacta para tipo choice), una confianza entre 0 y 1 y una cita breve del documento en evidence. Formato: {\"detectedKind\": string, \"summary\": string, \"answers\": [{\"playbookCode\": string, \"questionCode\": string, \"value\": any, \"confidence\": number, \"evidence\": string}]}.";

const DIAGRAM_SYSTEM_PROMPT =
  "Eres un ingeniero de redes que convierte un diagrama de topologia en una estructura. Responde exclusivamente con JSON valido: {\"title\": string, \"zones\": [{\"id\": string, \"label\": string, \"kind\": \"site|cloud|dmz|internet|datacenter|generic\"}], \"nodes\": [{\"id\": string, \"label\": string, \"sublabel\": string, \"kind\": string, \"zoneId\": string|null}], \"edges\": [{\"source\": string, \"target\": string, \"label\": string}], \"notes\": string}. Incluye solo lo que se ve en el diagrama. No inventes componentes ni conexiones. Usa como kind uno de: user, internet, app, server, k8s, cloud, siem, dns_server, directory, network_device, f5_xc_re, f5_xc_ce, nginx, nginx_ingress, bluecat_address_manager, bluecat_bdds, bluecat_micetro, bluecat_edge, livenx, livewire, liveassist, tap, generic.";

async function extractAnswersWithAi({ documentName, text, questions, userId }) {
  const result = await requestAiJson({
    featureCode: TECHNICAL_SCOPE_AI_FEATURES.documentFacts,
    role: "fast",
    system: EXTRACTION_SYSTEM_PROMPT,
    user: {
      documentName,
      questions: questions.map(({ playbookCode, question }) => ({
        playbookCode,
        questionCode: question.code,
        prompt: question.prompt,
        type: question.type,
        options: question.options,
        unit: question.unit,
      })),
      documentText: text.slice(0, MAX_AI_TEXT_CHARS),
    },
    schema: aiAnswersSchema,
    userId,
  });
  return result;
}

async function extractTopologyFromImage({ buffer, mimeType, userId }) {
  const result = await requestAiJson({
    featureCode: TECHNICAL_SCOPE_AI_FEATURES.diagram,
    role: "fast",
    system: DIAGRAM_SYSTEM_PROMPT,
    user: "Convierte este diagrama de topologia en la estructura solicitada.",
    images: [`data:${mimeType};base64,${buffer.toString("base64")}`],
    schema: aiDiagramSchema,
    userId,
    timeoutMs: 120_000,
  });
  return {
    topology: normalizeTopology(result),
    notes: result.notes,
  };
}

async function storeExtraction({
  opportunityId,
  document,
  detectedKind,
  facts,
  topology,
  redactions,
  status = "completed",
  errorMessage = null,
  userId,
}) {
  await query(
    `INSERT INTO opportunity_document_tech_extractions
       (opportunity_id, document_public_id, document_name, detected_kind, facts_json, topology_json, redaction_json, status, error_message, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      Number(opportunityId),
      document.publicId,
      String(document.originalFileName || "").slice(0, 255),
      detectedKind,
      facts ? JSON.stringify(facts) : null,
      topology ? JSON.stringify(topology) : null,
      redactions ? JSON.stringify(redactions) : null,
      status,
      errorMessage ? String(errorMessage).slice(0, 1000) : null,
      userId ? Number(userId) : null,
    ],
  );
}

export async function listTechnicalExtractions(opportunityId) {
  const rows = await query(
    `SELECT e.* FROM opportunity_document_tech_extractions e
     INNER JOIN (
       SELECT MAX(id) AS id FROM opportunity_document_tech_extractions
       WHERE opportunity_id = ? GROUP BY document_public_id
     ) latest ON latest.id = e.id
     ORDER BY e.created_at DESC`,
    [Number(opportunityId)],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    documentPublicId: row.document_public_id,
    documentName: row.document_name,
    detectedKind: row.detected_kind,
    facts: parseJsonSafe(row.facts_json, null),
    topology: parseJsonSafe(row.topology_json, null),
    redactions: parseJsonSafe(row.redaction_json, null),
    status: row.status,
    errorMessage: row.error_message || "",
    createdAt: row.created_at,
  }));
}

// Analyzes customer documents of the opportunity and stores the findings as suggested answers.
export async function analyzeOpportunityTechnicalDocuments({
  opportunityId,
  selections,
  playbooks,
  documentPublicIds = null,
  userId,
}) {
  const allDocuments = await listOpportunityDocuments({ opportunityId });
  const wanted = Array.isArray(documentPublicIds) && documentPublicIds.length
    ? new Set(documentPublicIds)
    : null;
  const documents = allDocuments
    .filter((document) => !wanted || wanted.has(document.publicId))
    .slice(0, MAX_DOCUMENTS_PER_RUN);

  const questionIndex = [];
  for (const selection of selections) {
    const playbook = playbooks.find((entry) => entry.code === selection.code);
    for (const question of questionsForSelection(playbook, selection.modules)) {
      questionIndex.push({ playbookCode: selection.code, question });
    }
  }
  const questionByKey = new Map(
    questionIndex.map((entry) => [`${entry.playbookCode}:${entry.question.code}`, entry]),
  );

  const summary = { documents: [], applied: 0, conflicts: [] };

  for (const document of documents) {
    const extension = path.extname(String(document.originalFileName || "")).toLowerCase();
    const entry = {
      documentPublicId: document.publicId,
      documentName: document.originalFileName,
      detectedKind: "unknown",
      applied: 0,
      hasTopology: false,
      redactions: 0,
      error: null,
    };
    try {
      let facts = null;
      let topology = null;
      let redactions = null;
      let candidates = [];

      if (extension === ".drawio") {
        const { stream } = await getDocumentContentStream({
          documentPublicId: document.publicId,
        });
        const buffer = await streamToBuffer(stream);
        topology = maskTopologyLabels(parseDrawioTopology(buffer.toString("utf8")));
        entry.detectedKind = "diagram";
      } else if (IMAGE_EXTENSIONS.has(extension)) {
        const { stream } = await getDocumentContentStream({
          documentPublicId: document.publicId,
        });
        const buffer = await streamToBuffer(stream);
        const mimeType = extension === ".png" ? "image/png" : "image/jpeg";
        const result = await extractTopologyFromImage({ buffer, mimeType, userId });
        topology = result.topology.nodes.length ? maskTopologyLabels(result.topology) : null;
        entry.detectedKind = topology ? "diagram" : "image";
      } else {
        const rawText =
          document.rawText || document.normalizedText || document.transcriptText || "";
        const masked = maskSecrets(rawText, {
          configLike: CONFIG_EXTENSIONS.has(extension),
        });
        redactions = masked.redactions;
        entry.redactions = masked.redactions.count;
        facts = analyzeTextDocument(masked.text);
        if (facts) {
          entry.detectedKind = facts.kind;
          candidates = candidatesFromFacts(facts);
        } else if (masked.text.trim().length > 80 && questionIndex.length) {
          const ai = await extractAnswersWithAi({
            documentName: document.originalFileName,
            text: masked.text,
            questions: questionIndex,
            userId,
          });
          entry.detectedKind = ai.detectedKind || "document";
          facts = { kind: "ai_extraction", summary: ai.summary, metrics: {}, lists: {}, features: [] };
          candidates = ai.answers.filter(
            (answer) => answer.confidence >= MIN_AI_CONFIDENCE,
          );
        }
      }

      for (const candidate of candidates) {
        const target = questionByKey.get(
          `${candidate.playbookCode}:${candidate.questionCode}`,
        );
        if (!target) continue;
        const result = await saveSuggestedAnswer({
          opportunityId,
          playbookCode: candidate.playbookCode,
          question: target.question,
          value: candidate.value,
          sourceType: "document",
          sourceRef: `${document.originalFileName}${candidate.evidence ? `: ${candidate.evidence}` : ""}`,
          confidence: candidate.confidence,
          userId,
        });
        if (result.stored) {
          entry.applied += 1;
          summary.applied += 1;
        } else if (result.conflict) {
          summary.conflicts.push({ ...result.conflict, documentName: document.originalFileName });
        }
      }

      entry.hasTopology = Boolean(topology);
      await storeExtraction({
        opportunityId,
        document,
        detectedKind: entry.detectedKind,
        facts,
        topology,
        redactions,
        userId,
      });
    } catch (error) {
      entry.error = error?.message || "No fue posible analizar el documento";
      await storeExtraction({
        opportunityId,
        document,
        detectedKind: entry.detectedKind,
        status: "failed",
        errorMessage: entry.error,
        userId,
      }).catch(() => {});
    }
    summary.documents.push(entry);
  }

  return summary;
}
