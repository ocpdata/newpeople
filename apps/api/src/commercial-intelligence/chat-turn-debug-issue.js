export function deriveTurnDebugIssue({ qualityTrace, response, evidenceStatus, evidenceDescription, fallbackUsed }) {
  let issue;
  if (response.responseType === "error") {
    issue = {
      severity: "error",
      title: evidenceDescription.issue?.severity === "error"
        ? evidenceDescription.issue.title
        : "El turno no pudo completarse",
      block: evidenceDescription.state === "error"
        ? "B9"
        : "B10",
      message: response.answer,
      nextAction:
        evidenceDescription.state === "error"
          ? evidenceDescription.issue?.nextAction ||
            "Revisa el estado de evidencia, las consultas fallidas y los límites en el bloque B9."
          : "Revisa el error de generación o auditoría de respuesta en el bloque B10.",
    };
  } else if (evidenceDescription.state === "error") {
    issue = evidenceDescription.issue || {
      severity: "error",
      title: "La evidencia no quedó verificada",
      block: "B9",
      message: `El verificador terminó con estado: ${evidenceStatus}.`,
      nextAction:
        "Revisa consultas fallidas, hechos pendientes, truncamientos y herramientas no ejecutadas.",
    };
  } else if (evidenceDescription.issue?.severity === "warning") {
    issue = evidenceDescription.issue;
  } else if (response.presentation?.status === "degraded") {
    issue = {
      severity: "warning", block: "B10",
      title: "Se conservó la respuesta verificada sin redacción conversacional",
      message: response.presentation.reasonCode,
      nextAction: "Revisa la generación y auditoría conversacional de B10; no se repitió la solicitud.",
    };
  } else if (response.responseType === "clarification") {
    issue = {
      severity: "warning",
      title: "El chat necesita una precisión para continuar",
      block: response.channelIntentRouting?.requiresClarification
        ? "B6"
        : "B10",
      message:
        response.clarification?.message ||
        response.answer ||
        "La solicitud necesita más contexto.",
      nextAction:
        "Revisa la ambigüedad o el dato faltante y responde con una referencia más específica.",
    };
  } else if (evidenceStatus === "no_results") {
    issue = {
      severity: "warning",
      title: "La consulta se ejecutó, pero no encontró coincidencias",
      block: "B9",
      message:
        "Esto no demuestra que el registro nunca haya existido; indica que no hubo resultados con los filtros consultados.",
      nextAction:
        "Comprueba filtros, cuenta seleccionada y alcance de las herramientas en B6–B8.",
    };
  } else if (
    fallbackUsed ||
    qualityTrace?.diagnostics?.planner?.fallbackUsed
  ) {
    issue = {
      severity: "warning",
      title: "El turno usó una ruta alternativa",
      block: "B6",
      message:
        "La interpretación principal no se utilizó o no estuvo disponible.",
      nextAction:
        "Revisa el plan, la intención elegida y el motivo del fallback en B6.",
    };
  } else if (evidenceDescription.issue) {
    issue = evidenceDescription.issue;
  } else {
    issue = {
      severity: "success",
      title: "El turno terminó sin señales de error",
      block: null,
      message:
        "La respuesta y el contexto para continuar quedaron guardados.",
      nextAction: "No hay un bloque que requiera revisión.",
    };
  }
  return { issue };
}
