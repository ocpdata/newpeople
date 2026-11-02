// Deterministic comparison of the figures and dates of an answer against the authorized evidence. It does not decide:
// a value that is not in the evidence may be a recommendation or a hypothesis, so the findings go to the answer audit
// and to the diagnostics instead of rejecting the answer.

const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const MONTH_PATTERN = MONTHS.join("|");
const SPANISH_DATE = new RegExp(
  `(\\d{1,2})\\s+de\\s+(${MONTH_PATTERN})(?:\\s+(?:de|del)\\s+(\\d{4}))?`,
  "gi",
);
const ISO_DATE = /(\d{4})-(\d{2})-(\d{2})/g;
const NUMBER =
  /(?<![\w.,/-])(\d{1,3}(?:[,. ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)(\s*%)?(?:\s*(millones|millón|millon|mil)\b)?/gi;

const normalizeText = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

// A figure can be written with commas (US) or dots (EU) as thousands separators; both readings are candidates.
export function numericCandidates(raw) {
  const compact = raw.replace(/\s+/g, "");
  const candidates = new Set();
  const us = Number(compact.replace(/,/g, ""));
  if (Number.isFinite(us)) candidates.add(us);
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(compact)) {
    const eu = Number(compact.replace(/\./g, "").replace(",", "."));
    if (Number.isFinite(eu)) candidates.add(eu);
  } else if (/^\d+,\d{1,2}$/.test(compact)) {
    const eu = Number(compact.replace(",", "."));
    if (Number.isFinite(eu)) candidates.add(eu);
  }
  return [...candidates];
}

export function multiplierFor(word) {
  const normalized = normalizeText(word);
  if (normalized.startsWith("millon")) return 1e6;
  if (normalized === "mil") return 1e3;
  return 1;
}

function* walkStrings(value, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return;
    // MySQL DATE columns arrive as Date objects at local midnight; both readings of the day are valid.
    const local = [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, "0"),
      String(value.getDate()).padStart(2, "0"),
    ].join("-");
    yield value.toISOString();
    yield local;
    return;
  }
  if (typeof value === "string") yield value;
  else if (typeof value === "number") yield String(value);
  else if (Array.isArray(value)) for (const item of value) yield* walkStrings(item, depth + 1);
  else if (typeof value === "object")
    for (const item of Object.values(value)) yield* walkStrings(item, depth + 1);
}

function withoutDates(text) {
  return String(text || "").replace(SPANISH_DATE, " ").replace(ISO_DATE, " ");
}

export function collectGroundingSources(sources) {
  const numbers = [];
  const isoDates = new Set();
  const monthDays = new Set();
  for (const source of sources) {
    for (const text of walkStrings(source)) {
      for (const match of text.matchAll(ISO_DATE)) {
        isoDates.add(match[0]);
        monthDays.add(`${match[2]}-${match[3]}`);
      }
      const numeric = Number(text);
      if (text.trim() !== "" && Number.isFinite(numeric)) numbers.push(Math.abs(numeric));
      for (const match of withoutDates(text).matchAll(NUMBER)) {
        const multiplier = multiplierFor(match[3] || "");
        for (const candidate of numericCandidates(match[1]))
          numbers.push(Math.abs(candidate) * multiplier);
      }
    }
  }
  return { numbers, isoDates, monthDays };
}

// Years and small integers (counts, ranks, days) are not worth comparing; amounts, percentages and decimals are.
function isSignificant({ value, hasPercent, hasDecimal, raw }) {
  if (hasPercent || hasDecimal) return true;
  if (/^(19|20)\d{2}$/.test(raw)) return false;
  return value >= 100;
}

export function matchesAny(value, evidenceNumbers, scaled) {
  const tolerance = scaled ? Math.max(0.51, value * 0.05) : Math.max(0.51, value * 0.0005);
  return evidenceNumbers.some((candidate) => Math.abs(candidate - value) <= tolerance);
}

export function verifyAnswerValues({ texts, sources }) {
  const evidence = collectGroundingSources(sources);
  const ungrounded = [];
  const seen = new Set();
  let checked = 0;
  const note = (entry) => {
    const key = `${entry.kind}:${entry.text}`;
    if (!seen.has(key)) {
      seen.add(key);
      ungrounded.push(entry);
    }
  };
  for (const text of texts.map((item) => String(item || "")).filter(Boolean)) {
    for (const match of text.matchAll(SPANISH_DATE)) {
      const month = MONTHS.indexOf(normalizeText(match[2])) + 1;
      const day = String(Number(match[1])).padStart(2, "0");
      const monthKey = String(month).padStart(2, "0");
      checked += 1;
      const found = match[3]
        ? evidence.isoDates.has(`${match[3]}-${monthKey}-${day}`)
        : evidence.monthDays.has(`${monthKey}-${day}`);
      if (!found) note({ kind: "date", text: match[0].trim() });
    }
    for (const match of withoutDates(text).matchAll(NUMBER)) {
      const raw = match[1];
      const hasPercent = Boolean(match[2]);
      const multiplier = multiplierFor(match[3] || "");
      const candidates = numericCandidates(raw).map((candidate) => candidate * multiplier);
      if (!candidates.length) continue;
      const hasDecimal = /[.,]\d{1,2}$/.test(raw.replace(/\s+/g, "")) &&
        !/^\d{1,3}([.,]\d{3})+$/.test(raw.replace(/\s+/g, ""));
      if (!isSignificant({ value: Math.max(...candidates), hasPercent, hasDecimal, raw })) continue;
      checked += 1;
      if (!candidates.some((value) => matchesAny(value, evidence.numbers, multiplier > 1)))
        note({ kind: hasPercent ? "percentage" : "number", text: match[0].trim() });
    }
  }
  return { checked, ungrounded };
}

// The sentences of a response that state data: the answer, the inferences and the excerpts of its facts.
export function answerTextsToVerify(response) {
  const inferences = (Array.isArray(response?.inferences) ? response.inferences : []).flatMap((item) =>
    typeof item === "string" ? [item] : [item?.label, item?.excerpt].filter(Boolean),
  );
  const facts = (Array.isArray(response?.facts) ? response.facts : [])
    .map((fact) => fact?.excerpt)
    .filter(Boolean);
  return [response?.answer, ...inferences, ...facts];
}
