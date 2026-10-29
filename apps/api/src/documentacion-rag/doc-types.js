export const RAG_DOCUMENT_TYPES = Object.freeze({
  questionnaire: "Cuestionario",
  manual: "Manual",
  design_guide: "Guía de diseño",
  implementation_guide: "Guía de implementación",
  reference_architecture: "Arquitectura de referencia",
  sample_config: "Configuración modelo",
  sizing_sheet: "Hoja de dimensionamiento",
  other: "Otro",
});

const DOC_TYPE_ALIASES = {
  cuestionario: "questionnaire",
  manual: "manual",
  "guia de diseno": "design_guide",
  guia: "design_guide",
  "guia de implementacion": "implementation_guide",
  implementacion: "implementation_guide",
  arquitectura: "reference_architecture",
  "arquitectura de referencia": "reference_architecture",
  configuracion: "sample_config",
  "configuracion modelo": "sample_config",
  dimensionamiento: "sizing_sheet",
  "hoja de dimensionamiento": "sizing_sheet",
  otro: "other",
};

function normalizeDocTypeLabel(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Accepts a code or a Spanish label ("Guía de diseño"); returns null when unknown.
export function resolveRagDocType(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (RAG_DOCUMENT_TYPES[raw]) return raw;
  return DOC_TYPE_ALIASES[normalizeDocTypeLabel(raw)] || null;
}

// File name convention "[Tipo] Titulo" classifies the document without extra input.
export function inferRagDocTypeFromFileName(fileName) {
  const match = /^\s*\[([^\]]+)\]/.exec(String(fileName || ""));
  return match ? resolveRagDocType(match[1]) : null;
}
