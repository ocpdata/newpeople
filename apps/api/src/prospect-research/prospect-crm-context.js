// CRM facts the Cuenta nueva chat may state about a prospect session: whether governance allows conversions and which
// existing accounts look like the prospect. The chat never queries the CRM itself; the service computes this context
// once per turn with the seller's own permissions and the adapter carries it as `session.crm`.

const MATCH_REASON = {
  domain: "Mismo sitio web",
  name_country: "Mismo nombre y país",
};

export function buildProspectCrmContext({ duplicateReview, conversionAllowed, similar = null, owners = {}, session = null, allowedKinds = null } = {}) {
  const checked = Boolean(duplicateReview?.completed);
  const duplicateCandidates = checked
    ? (duplicateReview.candidates || []).map((candidate) => ({
        accountId: Number(candidate.id),
        name: candidate.name || "",
        reason: MATCH_REASON[candidate.matchType] || "Posible coincidencia",
        country: candidate.country || "",
        activationStatus: candidate.activationStatus || "",
        owners: owners[Number(candidate.id)] || [],
      }))
    : [];
  return {
    conversionAllowed: conversionAllowed !== false,
    ...(Array.isArray(allowedKinds) ? { allowedKinds: [...allowedKinds] } : {}),
    duplicatesChecked: checked,
    duplicateCandidates,
    similarCustomers: similar,
    readiness: buildConversionReadiness({
      session, conversionAllowed: conversionAllowed !== false, duplicateCandidates, allowedKinds,
    }),
  };
}

const KIND_BY_TARGET = { account: "create_account", contact: "create_contact", opportunity: "create_opportunity" };
const TARGET_LABEL = { account: "cuenta", contact: "contacto", opportunity: "oportunidad" };

export const kindDisabledAnswer = (target) =>
  `Las reglas del servidor de Cuenta nueva no permiten proponer la creación de ${TARGET_LABEL[target] || "ese registro"} desde este chat. Si la necesitas, un administrador debe habilitarla. Todavía no se creó ningún registro en el CRM.`;

// What is still missing before each conversion could be confirmed; computed from the session and the CRM context so the
// chat reports facts instead of guessing the prerequisites.
export function buildConversionReadiness({ session = null, conversionAllowed = true, duplicateCandidates = [], allowedKinds = null } = {}) {
  const contacts = Array.isArray(session?.contacts) ? session.contacts : [];
  const hypotheses = Array.isArray(session?.hypotheses) ? session.hypotheses : [];
  const hasAccount = Boolean(session?.convertedAccountId);
  const disabled = conversionAllowed ? [] : ["la conversión está deshabilitada por el gobierno de Mi Coach"];
  const notAllowed = (target) =>
    Array.isArray(allowedKinds) && !allowedKinds.includes(KIND_BY_TARGET[target])
      ? ["las reglas del servidor no permiten proponer esta conversión"]
      : [];
  const needsAccount = hasAccount ? [] : ["una cuenta del CRM: convierte el prospecto en cuenta o indica una existente"];
  const account = hasAccount ? [] : [
    ...disabled,
    ...notAllowed("account"),
    ...(duplicateCandidates.length ? ["decidir entre usar la cuenta parecida que ya existe o crear una nueva"] : []),
  ];
  const contact = [
    ...disabled,
    ...notAllowed("contact"),
    ...needsAccount,
    ...(contacts.length ? [] : ["al menos una persona identificada en la sesión"]),
    ...(contacts.some((item) => String(item?.email || "").trim()) ? [] : ["correo o teléfono de la persona: no está en la sesión"]),
  ];
  const opportunity = [
    ...disabled,
    ...notAllowed("opportunity"),
    ...needsAccount,
    ...(hypotheses.length ? [] : ["al menos una hipótesis de oportunidad por validar"]),
    ...(contacts.length ? [] : ["una persona de la sesión como contacto de la oportunidad"]),
  ];
  const entry = (missing, extra = {}) => ({ ready: !missing.length, missing, ...extra });
  return {
    account: entry(account, { alreadyConverted: hasAccount }),
    contact: entry(contact),
    opportunity: entry(opportunity),
  };
}

// Returns null when the CRM context says nothing that blocks the request.
export function conversionBlock(crm, target) {
  if (!crm) return null;
  if (crm.conversionAllowed === false) return { reason: "disabled" };
  if (Array.isArray(crm.allowedKinds) && !crm.allowedKinds.includes(KIND_BY_TARGET[target] || `create_${target}`)) {
    return { reason: "kind_disabled", target };
  }
  if (target === "account" && Array.isArray(crm.duplicateCandidates) && crm.duplicateCandidates.length) {
    return { reason: "duplicates", candidates: crm.duplicateCandidates };
  }
  return null;
}

// Prerequisites of a conversion, as computed from the session and the CRM; null when the context carries no readiness.
export function readinessAnswer({ text, snapshot }) {
  const readiness = snapshot?.crm?.readiness;
  if (!readiness) return null;
  const target = /\boportunidad\b/.test(text) ? "opportunity" : /\bcontacto\b/.test(text) ? "contact" : "account";
  const label = { account: "cuenta del CRM", contact: "contacto del CRM", opportunity: "oportunidad" }[target];
  const company = snapshot.profile?.companyName || "el prospecto";
  const entry = readiness[target];
  if (target === "account" && entry?.alreadyConverted) {
    return `${company} ya se convirtió en cuenta del CRM. Para seguir, convierte a una persona o crea una oportunidad desde una hipótesis, con tu confirmación.`;
  }
  if (!entry) return null;
  return entry.ready
    ? `No falta nada para proponer la conversión de ${company} en ${label}: se revisa con tu confirmación antes de crear cualquier registro. Todavía no se creó nada en el CRM.`
    : `Para convertir ${company} en ${label} falta: ${entry.missing.join("; ")}. Todavía no se creó ningún registro en el CRM.`;
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
