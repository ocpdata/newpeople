export function getSubtypeCompatibilityLevel(policyByType, tipoCampana, subtipoCampana) {
  const tipo = String(tipoCampana || "").trim();
  const subtipo = String(subtipoCampana || "").trim();
  const policy = policyByType?.[tipo] || null;

  if (!policy || !subtipo) {
    return "bloqueado";
  }

  const allowed = Array.isArray(policy.permitido) ? policy.permitido : [];
  const requiresApproval = Array.isArray(policy.permitido_con_aprobacion)
    ? policy.permitido_con_aprobacion
    : [];

  if (allowed.includes(subtipo)) {
    return "permitido";
  }

  if (requiresApproval.includes(subtipo)) {
    return "permitido_con_aprobacion";
  }

  return "bloqueado";
}

export function getCompatibleSubtypeOptions(policyByType, allSubtypeValues, tipoCampana) {
  const tipo = String(tipoCampana || "").trim();
  const policy = policyByType?.[tipo] || null;
  const catalogValues = Array.isArray(allSubtypeValues) ? allSubtypeValues : [];

  if (!policy) {
    return catalogValues.map((value) => ({ value, nivel: "permitido" }));
  }

  return catalogValues
    .map((value) => ({
      value,
      nivel: getSubtypeCompatibilityLevel(policyByType, tipo, value),
    }))
    .filter((entry) => entry.nivel !== "bloqueado");
}

export function resolveCompatibleSubtypeValue(policyByType, allSubtypeValues, tipoCampana, currentSubtype) {
  const normalizedCurrent = String(currentSubtype || "").trim();
  const options = getCompatibleSubtypeOptions(policyByType, allSubtypeValues, tipoCampana);

  if (normalizedCurrent) {
    const currentOption = options.find((entry) => entry.value === normalizedCurrent);
    if (currentOption) {
      return normalizedCurrent;
    }
  }

  return options[0]?.value || normalizedCurrent || "";
}
