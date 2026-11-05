export async function lockQuotationClosure(connection, versionId, { allowAccepted = false } = {}) {
  const [rows] = await connection.query(
    `SELECT qv.id, qv.quotation_id, qv.updated_at, qs.code AS status_code,
            q.latest_version_id, q.opportunity_id
     FROM quotation_versions qv
     INNER JOIN quotations q ON q.id = qv.quotation_id
     INNER JOIN quotation_statuses qs ON qs.id = qv.status_id
     WHERE qv.id = ? FOR UPDATE`,
    [versionId],
  );
  const version = rows[0];
  if (!version || Number(version.id) !== Number(version.latest_version_id)) {
    throw Object.assign(new Error("La version actual de la cotizacion cambio. Recarga el procesamiento."), { status: 409 });
  }
  if (version.status_code === "aceptada" && !allowAccepted) {
    throw Object.assign(new Error("Cotizacion aceptada. No se permiten cambios en los documentos de cierre ni el envio de correo al vendedor."), {
      status: 409, code: "QUOTATION_ACCEPTED_LOCKED",
    });
  }
  if (!["ganada", "aceptada"].includes(version.status_code)) {
    throw Object.assign(new Error("Solo se puede procesar una cotizacion ganada o aceptada."), { status: 409 });
  }
  return version;
}
