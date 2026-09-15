export const PROPOSAL_FORMATS = {
  basic: { code: "basic", name: "Básico", accent: "#173d72", heading: "#173d72", text: "#1d2730", border: "#d6e4f7", surface: "#ffffff", headingFont: "Helvetica, Arial, sans-serif", bodyFont: "Helvetica, Arial, sans-serif", spacing: "28px", margin: "72px" },
  enterprise: { code: "enterprise", name: "Enterprise", accent: "#102a43", heading: "#102a43", text: "#243b53", border: "#bcccdc", surface: "#f7f9fc", headingFont: "Georgia, serif", bodyFont: "Arial, sans-serif", spacing: "36px", margin: "82px" },
  corporate: { code: "corporate", name: "Corporativo estructurado", accent: "#173d72", heading: "#173d72", text: "#1d2730", border: "#d6e4f7", surface: "#ffffff", headingFont: "Helvetica, Arial, sans-serif", bodyFont: "Helvetica, Arial, sans-serif", spacing: "28px", margin: "72px" },
  premium: { code: "premium", name: "Ejecutivo premium", accent: "#7c4f20", heading: "#5b3718", text: "#33261c", border: "#ead7bd", surface: "#fffdf9", headingFont: "Georgia, serif", bodyFont: "Georgia, serif", spacing: "38px", margin: "82px" },
  technical: { code: "technical", name: "Técnico compacto", accent: "#0d5964", heading: "#0d5964", text: "#20343a", border: "#c9e1e4", surface: "#f9fcfc", headingFont: "Arial, sans-serif", bodyFont: "Arial, sans-serif", spacing: "18px", margin: "58px" },
  editorial: { code: "editorial", name: "Editorial narrativo", accent: "#8a3654", heading: "#742d48", text: "#382731", border: "#efd5df", surface: "#fffafd", headingFont: "Georgia, serif", bodyFont: "Helvetica, Arial, sans-serif", spacing: "42px", margin: "86px" },
  solution: { code: "solution", name: "Visual de soluciones", accent: "#176b55", heading: "#145a49", text: "#20352f", border: "#cce7dd", surface: "#f8fdfb", headingFont: "Arial, sans-serif", bodyFont: "Arial, sans-serif", spacing: "30px", margin: "68px" },
  minimal: { code: "minimal", name: "Minimalista moderno", accent: "#344054", heading: "#101828", text: "#344054", border: "#eaecf0", surface: "#ffffff", headingFont: "Arial, sans-serif", bodyFont: "Arial, sans-serif", spacing: "24px", margin: "76px" },
};

export const DEFAULT_PROPOSAL_FORMAT_CODE = "basic";
export function getProposalFormat(code) { return PROPOSAL_FORMATS[code] || PROPOSAL_FORMATS[DEFAULT_PROPOSAL_FORMAT_CODE]; }
export function listProposalFormats() { return Object.values(PROPOSAL_FORMATS); }
