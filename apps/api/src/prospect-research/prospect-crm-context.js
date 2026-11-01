// CRM facts the Cuenta nueva chat may state about a prospect session: whether governance allows conversions and which
// existing accounts look like the prospect. The chat never queries the CRM itself; the service computes this context
// once per turn with the seller's own permissions and the adapter carries it as `session.crm`.

const MATCH_REASON = {
  domain: "Mismo sitio web",
  name_country: "Mismo nombre y país",
};

export function buildProspectCrmContext({ duplicateReview, conversionAllowed } = {}) {
  const checked = Boolean(duplicateReview?.completed);
  return {
    conversionAllowed: conversionAllowed !== false,
    duplicatesChecked: checked,
    duplicateCandidates: checked
      ? (duplicateReview.candidates || []).map((candidate) => ({
          accountId: Number(candidate.id),
          name: candidate.name || "",
          reason: MATCH_REASON[candidate.matchType] || "Posible coincidencia",
          country: candidate.country || "",
          activationStatus: candidate.activationStatus || "",
        }))
      : [],
  };
}

// Returns null when the CRM context says nothing that blocks the request.
export function conversionBlock(crm, target) {
  if (!crm) return null;
  if (crm.conversionAllowed === false) return { reason: "disabled" };
  if (target === "account" && Array.isArray(crm.duplicateCandidates) && crm.duplicateCandidates.length) {
    return { reason: "duplicates", candidates: crm.duplicateCandidates };
  }
  return null;
}

const describeCandidate = (candidate) => {
  const details = [candidate.reason, candidate.country, candidate.activationStatus].filter(Boolean).join(", ");
  return `${candidate.name}${details ? ` (${details})` : ""}`;
};

export function duplicatesAnswer(company, crm) {
  const candidates = crm?.duplicateCandidates || [];
  if (candidates.length) {
    return `Se detectó una posible cuenta duplicada en el CRM: ${candidates.map(describeCandidate).join("; ")}. Antes de convertir ${company} hay que decidir si se usa la cuenta existente o se crea una nueva; la conversión no continúa hasta resolverlo.`;
  }
  if (crm?.duplicatesChecked === false) {
    return `No puedo revisar si ${company} ya existe en el CRM porque tu usuario no tiene permiso para consultar cuentas. Pide a quien tenga acceso que lo verifique antes de convertir.`;
  }
  return `No encontré cuentas del CRM con nombre y país o sitio web similares a ${company} entre las que tu usuario puede consultar. La conversión vuelve a revisar duplicados al confirmarse.`;
}

export const CONVERSION_DISABLED_ANSWER =
  "La conversión de prospectos al CRM está deshabilitada por el gobierno de Mi Coach, así que no puedo proponerla ni crear cuentas, contactos u oportunidades desde esta sesión. Si la necesitas, un administrador debe habilitarla. Todavía no se creó ningún registro en el CRM.";
