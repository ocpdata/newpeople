import {
  buildCitationAnchors,
  normalizeForMatching,
  splitSentences,
} from "../commercial-intelligence/dossier/citation-anchors.js";
import {
  matchesAny,
  multiplierFor,
  numericCandidates,
  verifyAnswerValues,
} from "./answer-grounding.js";
import { entryFacts, entryText, normalizeEvidenceText } from "./evidence-index.js";

// Code-side verification of the claims the model proposes. The model writes the answer and lists each data point as a
// claim that cites evidence IDs and states its values; the code checks the IDs, the values, and that nothing in the
// answer escapes the claims. What it cannot check (an unsupported qualitative statement) stays with the answer audit,
// so an answer is accepted without that audit only when every sentence about the CRM is backed by a verified claim.

export const CLAIM_KINDS = Object.freeze(["registered", "inference", "recommendation", "to_confirm"]);
const VALUE_TYPES = Object.freeze(["amount", "number", "percent", "count", "date", "text"]);
const MAX_CLAIMS = 40;
const MAX_CLAIM_TEXT = 320;
const MAX_IDS_PER_CLAIM = 6;
const MAX_VALUES_PER_CLAIM = 6;
const MAX_FACTS = 12;
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const SPANISH_DATE = new RegExp(`(\\d{1,2})\\s+de\\s+(${MONTHS.join("|")})(?:\\s+(?:de|del)\\s+(\\d{4}))?`, "i");
const STOPWORDS = new Set([
  "para", "como", "esta", "este", "esto", "estan", "entre", "sobre", "desde", "pero", "porque", "donde", "cuando",
  "tiene", "tienen", "puede", "pueden", "hacia", "solo", "sino", "todo", "toda", "otra", "otro", "cada", "ahora",
  "tambien", "segun", "hasta", "tras", "seria", "serian", "fueron", "estos", "estas", "algun", "alguna", "debe",
  "actualmente", "ademas", "aunque", "mientras", "dentro", "fuera", "cual", "cuales", "estar", "sido", "hace", "hacer",
  "tener", "unos", "unas", "dicho", "misma", "mismo", "varios", "varias", "entonces", "luego", "antes", "despues",
  "durante", "dado", "dada", "esta", "estas", "esos", "esas", "aquel", "aqui", "hay", "habia", "haber", "ser", "esta",
]);
const CONNECTORS = new Set(["de", "del", "la", "las", "los", "y", "e", "para", "en", "con", "al", "el"]);
// Product vocabulary that is capitalized in prose but is not a record of the CRM.
const KNOWN_TERMS = ["mi coach", "ritmo comercial", "biblioteca de ventas", "cliente existente", "cuenta nueva", "proceso comercial"];

const tokensOf = (text) =>
  new Set(
    (normalizeForMatching(text).match(/[a-z0-9]+/g) || []).filter((word) => word.length >= 4 && !STOPWORDS.has(word)),
  );

export function parseClaims(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const claims = [];
  for (const item of list.slice(0, MAX_CLAIMS)) {
    const text = String(item?.text || "").replace(/\s+/g, " ").trim().slice(0, MAX_CLAIM_TEXT);
    if (!text) continue;
    const ids = (Array.isArray(item?.evidenceIds) ? item.evidenceIds : [])
      .map((id) => String(id).trim())
      .filter(Boolean)
      .slice(0, MAX_IDS_PER_CLAIM);
    const kind = CLAIM_KINDS.includes(item?.kind) ? item.kind : ids.length ? "registered" : "inference";
    const values = (Array.isArray(item?.values) ? item.values : [])
      .filter((value) => value && value.value !== undefined && value.value !== null && String(value.value).trim() !== "")
      .map((value) => ({
        type: VALUE_TYPES.includes(value.type) ? value.type : "text",
        value: String(value.value).trim().slice(0, 160),
        evidenceId: value.evidenceId ? String(value.evidenceId).trim() : null,
      }))
      .slice(0, MAX_VALUES_PER_CLAIM);
    claims.push({ text, kind, evidenceIds: [...new Set(ids)], values });
  }
  return claims;
}

function dateMatches(raw, facts) {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return facts.isoDates.has(iso[0]);
  const spanish = SPANISH_DATE.exec(normalizeForMatching(raw).replace(/\s+/g, " "));
  if (!spanish) return false;
  const month = String(MONTHS.indexOf(spanish[2]) + 1).padStart(2, "0");
  const day = String(Number(spanish[1])).padStart(2, "0");
  return spanish[3] ? facts.isoDates.has(`${spanish[3]}-${month}-${day}`) : facts.monthDays.has(`${month}-${day}`);
}

function valueMatchesEntries(value, entries) {
  if (!entries.length) return false;
  if (value.type === "date") return entries.some((entry) => dateMatches(value.value, entryFacts(entry)));
  if (value.type === "text") {
    const needle = normalizeEvidenceText(value.value);
    return Boolean(needle) && entries.some((entry) => entryText(entry).includes(` ${needle} `));
  }
  const multiplier = multiplierFor(String(value.value).match(/millones|millón|millon|mil\b/i)?.[0] || "");
  const numeric = String(value.value).match(/\d[\d.,\s]*\d|\d/)?.[0];
  if (!numeric) return false;
  const candidates = numericCandidates(numeric).map((candidate) => candidate * multiplier);
  return candidates.some((candidate) =>
    entries.some((entry) => matchesAny(candidate, entryFacts(entry).numbers, multiplier > 1)),
  );
}

// Verifies each claim against the entries it cites. A "registered" claim must cite evidence and every value it states must
// appear in that evidence; an inference may rest on any evidence of the turn.
export function verifyClaims({ claims, index, question = "", history = [], guide = "" }) {
  const allContents = [...index.entries.values()].map((entry) => entry.content);
  return claims.map((claim) => {
    const reasons = [];
    const cited = claim.evidenceIds.map((id) => ({ id, entry: index.entries.get(id) }));
    for (const { id, entry } of cited) if (!entry) reasons.push(`unknown_evidence:${id}`);
    const entries = cited.map(({ entry }) => entry).filter(Boolean);
    if (claim.kind === "registered" && !entries.length) reasons.push("registered_without_evidence");
    if (claim.kind === "registered" || (claim.kind === "inference" && entries.length)) {
      for (const value of claim.values) {
        const scope = value.evidenceId && index.entries.get(value.evidenceId) ? [index.entries.get(value.evidenceId)] : entries;
        if (!valueMatchesEntries(value, scope)) reasons.push(`value_not_in_evidence:${value.type}:${value.value}`);
      }
    }
    if (claim.kind === "registered" || claim.kind === "inference") {
      const sources = claim.kind === "registered" && entries.length ? entries.map((entry) => entry.content) : allContents;
      const unmatched = verifyAnswerValues({ texts: [claim.text], sources: [...sources, question, history, guide] }).ungrounded;
      for (const item of unmatched) reasons.push(`text_value_not_in_evidence:${item.text}`);
    }
    return { ...claim, status: reasons.length ? "rejected" : "verified", reasons };
  });
}

// A sentence about the CRM is covered when almost all of its content words come from the claims, the names of the turn's
// records or the question. A sentence that shares only the name of a record with the claims says something new about it.
const COVERAGE_MIN_RATIO = 0.8;

export function uncoveredSentences({ answer, claims, entityLabels, extraVocabulary = "" }) {
  const labels = [...entityLabels].filter((label) => label.length >= 4);
  const vocabulary = new Set([...tokensOf(extraVocabulary)]);
  for (const claim of claims) for (const token of tokensOf(claim.text)) vocabulary.add(token);
  for (const label of labels) for (const token of tokensOf(label)) vocabulary.add(token);
  return splitSentences(answer)
    .filter((sentence) => !/\?\s*[*"»)]*$/.test(sentence.text))
    .filter((sentence) => {
      const normalized = ` ${normalizeEvidenceText(sentence.text)} `;
      const factual = /\d/.test(sentence.text) || labels.some((label) => normalized.includes(` ${label} `));
      if (!factual) return false;
      const words = [...tokensOf(sentence.text)];
      if (!words.length) return false;
      return words.filter((word) => vocabulary.has(word)).length / words.length < COVERAGE_MIN_RATIO;
    })
    .map((sentence) => sentence.text.slice(0, 160));
}

// Capitalized sequences ("Grupo Diestra") and quoted names that do not appear anywhere in the turn's sources. A sequence
// such as "Proteccion de Documentos Sealpath de Grupo Diestra" joins two records, so it is known when it splits at its
// connectors into parts that are each in the sources.
export function unknownNames({ answer, haystack }) {
  const normalizedHaystack = ` ${normalizeEvidenceText(haystack)} `;
  const known = (words) => {
    const phrase = normalizeEvidenceText(words.join(" "));
    return phrase !== "" && (KNOWN_TERMS.includes(phrase) || normalizedHaystack.includes(` ${phrase} `));
  };
  const covered = (words, start = 0) => {
    if (start >= words.length) return true;
    for (let end = words.length; end > start; end -= 1) {
      if (!known(words.slice(start, end))) continue;
      if (end === words.length) return true;
      if (CONNECTORS.has(words[end].toLowerCase()) ? covered(words, end + 1) : covered(words, end)) return true;
    }
    return false;
  };
  const candidates = [];
  for (const match of String(answer || "").matchAll(/[«"“‘']([^»"”’']{3,80})[»"”’']/g)) {
    candidates.push({ words: match[1].trim().split(/\s+/), sentenceStart: false });
  }
  let run = [];
  let runAtSentenceStart = false;
  let atSentenceStart = true;
  const flush = () => {
    while (run.length && CONNECTORS.has(run[run.length - 1].toLowerCase())) run.pop();
    if (run.filter((token) => !CONNECTORS.has(token.toLowerCase())).length >= 2) {
      candidates.push({ words: run, sentenceStart: runAtSentenceStart });
    }
    run = [];
  };
  for (const raw of String(answer || "").split(/\s+/)) {
    const token = raw.replace(/^[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9]+|[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9]+$/g, "");
    if (/^[A-ZÁÉÍÓÚÑ]/.test(token) && token.length >= 2) {
      if (!run.length) runAtSentenceStart = atSentenceStart;
      run.push(token);
    } else if (run.length && CONNECTORS.has(token.toLowerCase())) run.push(token);
    else flush();
    atSentenceStart = false;
    if (/[.!?:;,]$/.test(raw)) {
      flush();
      atSentenceStart = /[.!?:]$/.test(raw);
    }
  }
  flush();
  // The first word of a sentence is capitalized by grammar ("Revisa Grupo Diestra"), not because it is a name.
  const unknown = candidates
    .filter(({ words, sentenceStart }) => !covered(words) && !(sentenceStart && covered(words.slice(1))))
    .map(({ words, sentenceStart }) => (sentenceStart && words.length > 2 ? words.slice(1) : words).join(" "));
  return [...new Set(unknown)];
}

export function factsFromClaims(claims, entries) {
  const seen = new Set();
  const facts = [];
  for (const claim of claims) {
    if (claim.status !== "verified" || claim.kind !== "registered") continue;
    const entry = entries.get(claim.evidenceIds.find((id) => entries.has(id)));
    if (!entry) continue;
    const key = `${entry.id}:${claim.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    facts.push({ sourceType: entry.sourceType, sourceId: entry.recordId, label: entry.label, excerpt: claim.text.slice(0, 400) });
    if (facts.length >= MAX_FACTS) break;
  }
  return facts;
}

// Full verification of one synthesis. `accepted` means every sentence about the CRM is backed by a verified claim and no
// figure, date or name of the answer is missing from the evidence: the audit by the model can be skipped.
export function verifySynthesis({ answer, rawClaims, index, question = "", history = [], guide = "", activeContext = null }) {
  const claims = verifyClaims({ claims: parseClaims(rawClaims), index, question, history, guide });
  const verifiedRegistered = claims.filter((claim) => claim.status === "verified" && claim.kind === "registered");
  const rejected = claims.filter((claim) => claim.status === "rejected");
  const citedContents = verifiedRegistered
    .flatMap((claim) => claim.evidenceIds)
    .map((id) => index.entries.get(id)?.content)
    .filter(Boolean);
  const answerValues = verifyAnswerValues({
    texts: [answer],
    sources: [citedContents, question, history, guide, activeContext],
  });
  const entityLabels = new Set(
    [...index.entries.values()].filter((entry) => entry.recordId).map((entry) => normalizeEvidenceText(entry.label)),
  );
  const haystack = [
    ...[...index.entries.values()].map((entry) => entry.label),
    ...[...index.entries.values()].map((entry) => entryText(entry)),
    question,
    JSON.stringify(history || []),
    guide,
    JSON.stringify(activeContext || {}),
  ].join(" ");
  const names = unknownNames({ answer, haystack });
  const uncovered = uncoveredSentences({ answer, claims, entityLabels, extraVocabulary: question });
  const hasData = /\d/.test(String(answer || "")) || [...entityLabels].some((label) => label.length >= 4 && ` ${normalizeEvidenceText(answer)} `.includes(` ${label} `));
  const reasons = [];
  if (!claims.length) reasons.push("no_claims");
  if (rejected.length) reasons.push("rejected_claims");
  if (hasData && !verifiedRegistered.length) reasons.push("no_verified_claims");
  if (answerValues.ungrounded.length) reasons.push("values_not_in_cited_evidence");
  if (names.length) reasons.push("unknown_names");
  if (uncovered.length) reasons.push("uncovered_sentences");

  const citedIds = [];
  for (const claim of verifiedRegistered)
    for (const id of claim.evidenceIds) if (index.entries.has(id) && !citedIds.includes(id)) citedIds.push(id);
  const anchors = citedIds.length
    ? buildCitationAnchors({
        answerText: String(answer || ""),
        blocks: [
          {
            claims: verifiedRegistered.map((claim) => ({
              text: claim.text,
              evidenceIds: claim.evidenceIds,
              values: claim.values.map((value) => ({ value: value.value, type: value.type })),
            })),
          },
        ],
        citedEvidenceIds: citedIds,
      })
    : [];
  const citations = citedIds.map((id) => {
    const entry = index.entries.get(id);
    const claim = verifiedRegistered.find((item) => item.evidenceIds.includes(id));
    return {
      evidenceId: id,
      sourceType: entry.sourceType,
      sourceId: entry.recordId,
      label: entry.label,
      detail: entry.detail || null,
      excerpt: claim ? claim.text.slice(0, 240) : null,
    };
  });
  return {
    accepted: reasons.length === 0,
    reasons,
    claims,
    rejected: rejected.map((claim) => ({ text: claim.text.slice(0, 160), reasons: claim.reasons.slice(0, 3) })),
    answerValues,
    unknownNames: names.slice(0, 5),
    uncovered: uncovered.slice(0, 5),
    facts: factsFromClaims(claims, index.entries),
    inferences: claims.filter((claim) => claim.kind === "inference" && claim.status === "verified").map((claim) => claim.text),
    pending: claims.filter((claim) => claim.kind === "to_confirm").map((claim) => claim.text),
    citations,
    citationAnchors: anchors,
    stats: { claims: claims.length, verified: verifiedRegistered.length, rejected: rejected.length },
  };
}
