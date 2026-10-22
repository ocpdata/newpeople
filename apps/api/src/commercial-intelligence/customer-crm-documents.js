import { listCustomerCrmDocuments, readCustomerCrmDocument } from "../coach/customer-document-access.js";
import { listAuthorizedCoachQuotations } from "../coach/quotation-read-service.js";
import { answerCustomerDocument, selectCustomerQuotation } from "./customer-documents.js";
import { normalizeCustomerSearchText } from "./customer-record-list.js";

const response = (answer, responseType, memory, partial = false, extra = {}) => ({
  answer, responseType, operations: [], evidence: [], inferences: [], pendingItems: [], recommendedActions: [],
  documentMemory: memory, documentCoverage: { source: memory.source, partial },
  ...extra,
});

export async function answerCustomerCrmDocuments({
  request, component, user, jobId, signal, read, canRead = () => true,
  listDocuments = listCustomerCrmDocuments, readDocument = readCustomerCrmDocument,
  listQuotations = listAuthorizedCoachQuotations, answerDocument = answerCustomerDocument,
}) {
  let memory = { ...request.memory, documentIds: [], documentCandidates: [] };
  const documentReference = request.spec.documentReference ||
    (!["list", "all"].includes(request.spec.documentSelection) ? request.previous?.documentReference : "") || "";
  const options = { user, accountId: memory.accountId, opportunityId: memory.opportunityId,
    source: request.source, documentReference, signal };
  if (request.source === "quotation_document") {
    const listing = await read("Resolver cotización de los archivos", 1, () => listQuotations({
      ...options, quotationReference: request.quotationReference ||
        (request.previous?.quotationId ? String(request.previous.quotationId) : ""),
    }));
    const selection = selectCustomerQuotation({ request: { ...request, previous: request.previous ?
      { ...request.previous, candidates: [] } : null }, listing });
    if (selection.response) return selection.response;
    options.quotationId = selection.selected.quotationId;
    options.versionNumber = request.versionNumber;
    memory.quotationReference = request.quotationReference || request.previous?.quotationReference ||
      String(selection.selected.quotationId);
  }
  let listing = await read("Listar documentos CRM autorizados", 1, () => listDocuments(options));
  if (!listing.candidates.length && request.spec.documentReference &&
      request.previous?.documentCandidates?.length) {
    options.documentIds = request.previous.documentCandidates;
    options.documentReference = "";
    if (listing.version) options.versionNumber = listing.version.versionNumber;
    listing = await read("Revalidar nombres de la lista documental anterior", 1, () => listDocuments(options));
  }
  memory = { ...memory, ...(listing.version || {}), documentReference,
    documentCandidates: listing.candidates.map((item) => item.documentId) };
  // Pin reads to the listed version, including an explicitly selected historical revision.
  if (listing.version) options.versionNumber = listing.version.versionNumber;
  const candidates = listing.candidates;
  const origin = request.source === "opportunity_document"
    ? `Oportunidad ${request.opportunity.name}`
    : `Cotización ${memory.quotationId} · versión ${memory.versionNumber} · ${request.opportunity.name}`;
  const list = (message, type = "clarification") => {
    const answer = `${origin}\n${message}${candidates.length ? `\n${candidates.map((item, index) =>
      `${index + 1}. ${item.name} · ${item.aiEnabled ? `extracción: ${item.extractionStatus}` : "excluido de IA"}`).join("\n")}` : ""}${
      listing.truncated ? "\nCobertura parcial: se muestran hasta 50 documentos. Precisa la fuente; no se consultó el resto." : ""}`;
    return response(answer, type, memory, listing.truncated, {
      documentListing: answer,
      documentCoverage: { source: memory.source, partial: listing.truncated === true, kind: "metadata_only" },
    });
  };
  if (request.spec.documentSelection === "list" && !component.listPosition) {
    return list("Documentos asociados disponibles:", "informational");
  }
  if (!candidates.length) return list(documentReference
    ? `No encontré documentos asociados disponibles con el nombre "${documentReference}" en esta fuente.`
    : "No encontré documentos asociados disponibles en esta fuente.", "informational");

  const sameVersion = request.source !== "quotation_document" ||
    request.previous?.versionId === memory.versionId;
  let selected;
  if (component.listPosition > 0) {
    const prior = request.previous?.documentCandidates;
    if (!sameVersion || !prior?.[component.listPosition - 1] ||
        prior.length !== candidates.length || prior.some((id, index) => candidates[index]?.documentId !== id)) {
      return list("La lista anterior cambió o ya no es verificable. Selecciona de esta lista actualizada.");
    }
    selected = [candidates[component.listPosition - 1]];
  } else if (request.spec.documentReference && request.spec.documentSelection !== "previous") {
    const reference = normalizeCustomerSearchText(request.spec.documentReference);
    selected = candidates.filter((item) => normalizeCustomerSearchText(item.name) === reference);
    if (selected.length !== 1 || listing.truncated) return list(
      selected.length ? "Hay varias coincidencias o la lista es parcial. Precisa el archivo." :
        "No encontré un archivo inequívoco con ese nombre entre los documentos recuperados.");
  } else if (request.spec.documentSelection === "all") {
    selected = candidates;
  } else if (sameVersion && request.previous?.documentIds?.length) {
    selected = candidates.filter((item) => request.previous.documentIds.includes(item.documentId));
    if (selected.length !== request.previous.documentIds.length) {
      return list("La selección anterior ya no está disponible. Selecciona una fuente actual.");
    }
  } else if (candidates.length === 1 && !listing.truncated) {
    selected = candidates;
  } else return list("Hay varios documentos. Indica cuál deseas consultar o solicita consultarlos todos.");

  const omitted = Math.max(0, selected.length - 5);
  selected = selected.slice(0, 5);
  memory.documentIds = selected.map((item) => item.documentId);
  const fragments = [], warnings = [], sources = [];
  if (omitted || listing.truncated) warnings.push(
    `Consulta limitada a un máximo de cinco documentos por turno; ${omitted} de los recuperados quedaron fuera.${
      listing.truncated ? " La lista de origen también es parcial." : ""}`);
  for (const [index, candidate] of selected.entries()) {
    if (!candidate.aiEnabled) {
      warnings.push(`${candidate.name}: excluido del uso con IA; no se leyó su contenido.`);
      continue;
    }
    if (!canRead()) {
      warnings.push(`Presupuesto de lecturas agotado: no se consultaron ${selected.length - index} documentos restantes.`);
      break;
    }
    const document = await read("Leer documento CRM autorizado", 1, () =>
      readDocument({ ...options, documentId: candidate.documentId }));
    if (listing.version && document.versionId !== listing.version.versionId) {
      throw Object.assign(new Error("La versión documental cambió durante la lectura."), { code: "CUSTOMER_DOCUMENT_VERSION_CHANGED" });
    }
    const sourceInfo = { name: candidate.name, documentId: candidate.documentId, source: request.source,
      ...(listing.version || {}), status: document.status, kind: document.kind || null,
      availableLength: 0, originalLength: document.originalLength || null };
    sources.push(sourceInfo);
    if (document.status !== "ready") {
      warnings.push(`${candidate.name}: ${document.message}`);
      continue;
    }
    const prefix = `${candidate.name}${document.versionNumber ? ` · versión ${document.versionNumber}` : ""} [${document.kind}]: `;
    let remaining = Math.floor(12000 / selected.length), offset = 0, fragmentNumber = 1;
    while (offset < document.text.length && remaining > prefix.length) {
      const length = Math.min(1000 - prefix.length, remaining - prefix.length, document.text.length - offset);
      fragments.push({ key: `doc${index + 1}-f${fragmentNumber++}`,
        text: `${prefix}${document.text.slice(offset, offset + length)}` });
      offset += length;
      remaining -= prefix.length + length;
    }
    sourceInfo.availableLength = offset;
  }
  if (!fragments.length) return response(`${origin}\nNo pude leer contenido documental utilizable.\n${warnings.join("\n")}`,
    "informational", memory, true, { documentSources: sources });
  const result = await answerDocument({
    request: { ...request, memory, sourceLabel: `${origin}\nArchivos: ${sources.filter((item) => item.status === "ready").map((item) => item.name).join(", ")}`,
      fragments, partial: true },
    user, jobId, signal,
  });
  return { ...result, documentMemory: memory, documentSources: sources,
    ...(warnings.length ? { answer: `${result.answer}\nLímites de lectura:\n${warnings.join("\n")}` } : {}) };
}
