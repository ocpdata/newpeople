// Links the sentences of the analyst's answer to the CRM records that support them, without asking the model
// for anything new: each verified claim (text, structured values, cited records) is matched to the sentence of
// answerText it most resembles. A sentence with no clear match gets no marker; a wrong marker would be worse
// than none, so the thresholds are conservative.

const MAX_MARKERS_PER_SENTENCE = 4;
const MIN_TOKEN_LENGTH = 4;
const STOPWORDS = new Set([
  "para", "como", "esta", "este", "esto", "estan", "entre", "sobre", "desde", "pero", "porque", "donde", "cuando",
  "tiene", "tienen", "puede", "pueden", "hacia", "solo", "sino", "todo", "toda", "otra", "otro", "cada", "ahora",
  "tambien", "segun", "hasta", "tras", "seria", "serian", "fueron", "estos", "estas", "algun", "alguna", "debe",
]);
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export const normalizeForMatching = (text) => String(text || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[*_`#>|[\]()~]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const tokens = (text) => new Set((normalizeForMatching(text).match(/[a-z0-9]+/g) || [])
  .filter((word) => word.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(word)));

export function valueVariants(value) {
  const raw = String(value?.value ?? "").trim();
  if (!raw) return [];
  const variants = new Set([normalizeForMatching(raw)]);
  const date = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (date) {
    const [, year, month, day] = date;
    const monthName = MONTHS[Number(month) - 1];
    if (monthName) {
      variants.add(`${Number(day)} de ${monthName} de ${year}`);
      variants.add(`${Number(day)} de ${monthName}`);
    }
    variants.add(`${day}/${month}/${year}`);
  }
  if (["amount", "amount_total"].includes(value.type) && /^-?\d+(\.\d+)?$/.test(raw)) {
    const [integer, decimals] = raw.split(".");
    const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    variants.add(grouped);
    variants.add(grouped.replace(/,/g, "."));
    variants.add(grouped.replace(/,/g, " "));
    variants.add(integer);
    if (decimals && /^0+$/.test(decimals)) variants.add(`${grouped}.${decimals}`);
  }
  return [...variants].filter((variant) => variant.length >= 2);
}

function containsValue(normalizedSentence, variant) {
  const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(normalizedSentence);
}

// Splits answerText into sentences with their offsets; tables and headings are not anchored.
export function splitSentences(answerText) {
  const text = String(answerText || "");
  const sentences = [];
  const lineRegex = /[^\n]+/g;
  let line;
  while ((line = lineRegex.exec(text))) {
    const content = line[0];
    if (/^\s*(\||#)/.test(content)) continue;
    const boundary = /[.!?…]["»)*]*\s+(?=[A-ZÁÉÍÓÚÑ¿¡0-9*"«(])/g;
    // A list marker ("1.", "-") is not the end of a sentence.
    const marker = /^\s*(?:\d+[.)]|[-*•+])\s+/.exec(content);
    let start = marker ? marker[0].length : 0;
    boundary.lastIndex = start;
    const push = (from, to) => {
      const slice = content.slice(from, to);
      const trimmedStart = from + (slice.length - slice.trimStart().length);
      const trimmedEnd = from + slice.trimEnd().length;
      if (trimmedEnd > trimmedStart) {
        sentences.push({ start: line.index + trimmedStart, end: line.index + trimmedEnd, text: content.slice(trimmedStart, trimmedEnd) });
      }
    };
    let match;
    while ((match = boundary.exec(content))) {
      push(start, match.index + match[0].trimEnd().length);
      start = match.index + match[0].length;
    }
    push(start, content.length);
  }
  return sentences;
}

function scoreClaim(claim, sentence) {
  const claimTokens = tokens(claim.text);
  if (!claimTokens.size) return 0;
  const sentenceTokens = tokens(sentence.text);
  let shared = 0;
  for (const token of claimTokens) if (sentenceTokens.has(token)) shared += 1;
  const overlap = shared / claimTokens.size;
  const normalizedSentence = normalizeForMatching(sentence.text);
  const valueHit = (claim.values || []).some((value) => valueVariants(value).some((variant) => containsValue(normalizedSentence, variant)));
  if (overlap >= 0.5 || (valueHit && overlap >= 0.2)) return overlap + (valueHit ? 0.5 : 0);
  return 0;
}

/**
 * @param {string} answerText the analyst's answer, as it starts the final answer
 * @param {Array} blocks analysis blocks with their claims
 * @param {string[]} citedEvidenceIds evidence ids in the order of the citation list shown to the seller
 * @returns {{start:number,end:number,quote:string,citations:number[]}[]} citations are 1-based positions in that list
 */
export function buildCitationAnchors({ answerText, blocks = [], citedEvidenceIds = [] }) {
  const text = String(answerText || "");
  if (!text.trim() || !citedEvidenceIds.length) return [];
  const numberById = new Map(citedEvidenceIds.map((id, index) => [id, index + 1]));
  const sentences = splitSentences(text);
  const bySentence = new Map();
  for (const block of blocks) {
    for (const claim of block.claims || []) {
      const numbers = [...new Set((claim.evidenceIds || []).map((id) => numberById.get(id)).filter(Boolean))];
      if (!numbers.length) continue;
      let best = null;
      sentences.forEach((sentence, index) => {
        const score = scoreClaim(claim, sentence);
        if (score > 0 && (!best || score > best.score)) best = { index, score };
      });
      if (!best) continue;
      const entry = bySentence.get(best.index) || new Set();
      numbers.forEach((number) => entry.add(number));
      bySentence.set(best.index, entry);
    }
  }
  return [...bySentence.entries()].sort(([a], [b]) => a - b).map(([index, numbers]) => {
    const sentence = sentences[index];
    return {
      start: sentence.start,
      end: sentence.end,
      quote: sentence.text.slice(-60),
      citations: [...numbers].sort((a, b) => a - b).slice(0, MAX_MARKERS_PER_SENTENCE),
    };
  });
}

// Anchors stay valid only while the text they were computed on is unchanged.
export function anchorsMatchText(answer, anchors) {
  const text = String(answer || "");
  return (Array.isArray(anchors) ? anchors : []).filter((anchor) =>
    Number.isInteger(anchor?.start) && Number.isInteger(anchor?.end) && anchor.end <= text.length && anchor.start < anchor.end &&
    text.slice(anchor.end - String(anchor.quote || "").length, anchor.end) === anchor.quote);
}
