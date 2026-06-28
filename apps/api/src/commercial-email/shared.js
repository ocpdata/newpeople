import {
  getCommercialEnablementAssetDetail,
  listCommercialEnablementAssets,
} from "../commercial-enablement/service.js";

export const COMMERCIAL_EMAIL_ATTACHMENT_MAX_FILES = 10;
export const COMMERCIAL_EMAIL_ATTACHMENT_MAX_TOTAL_BYTES = 15 * 1024 * 1024;
export const COMMERCIAL_EMAIL_LIBRARY_SUGGESTION_MAX_FILES = 3;
export const COMMERCIAL_EMAIL_ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "text/plain",
  "image/png",
  "image/jpeg",
]);

export function isCommercialEmailAttachmentMimeTypeAllowed(mimeType) {
  const normalizedMimeType = String(mimeType || "")
    .trim()
    .toLowerCase();
  return COMMERCIAL_EMAIL_ALLOWED_ATTACHMENT_MIME_TYPES.has(normalizedMimeType);
}

export function normalizeCommercialEmailAttachment(
  attachment = {},
  {
    allowedSourceTypes = [
      "library_file",
      "opportunity_document",
      "interaction_document",
      "quotation_pdf",
    ],
  } = {},
) {
  const sourceType = String(attachment.sourceType || "").trim();
  if (!sourceType || !allowedSourceTypes.includes(sourceType)) {
    return null;
  }

  const normalized = {
    id:
      String(attachment.id || "").trim() ||
      `${sourceType}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    sourceType,
    sourceLabel: String(attachment.sourceLabel || "").trim(),
    fileName: String(attachment.fileName || "").trim(),
    mimeType: String(attachment.mimeType || "")
      .trim()
      .toLowerCase(),
    byteSize:
      attachment.byteSize === null || attachment.byteSize === undefined
        ? null
        : Number(attachment.byteSize),
    resourcePublicId: String(attachment.resourcePublicId || "").trim(),
    filePublicId: String(attachment.filePublicId || "").trim(),
    documentPublicId: String(attachment.documentPublicId || "").trim(),
    quotationId: attachment.quotationId ? Number(attachment.quotationId) : null,
    quotationVersionId: attachment.quotationVersionId
      ? Number(attachment.quotationVersionId)
      : null,
    proposalName: String(attachment.proposalName || "").trim(),
    title: String(attachment.title || "").trim(),
    summary: String(attachment.summary || "").trim(),
    assetTypeLabel: String(attachment.assetTypeLabel || "").trim(),
    selectionSource: String(attachment.selectionSource || "").trim(),
  };

  if (normalized.sourceType === "library_file") {
    return normalized.resourcePublicId && normalized.filePublicId
      ? normalized
      : null;
  }

  if (
    normalized.sourceType === "opportunity_document" ||
    normalized.sourceType === "interaction_document"
  ) {
    return normalized.documentPublicId ? normalized : null;
  }

  if (normalized.sourceType === "quotation_pdf") {
    return normalized.quotationVersionId ? normalized : null;
  }

  return null;
}

export function normalizeCommercialEmailDraft(
  details = {},
  {
    allowedSourceTypes = [
      "library_file",
      "opportunity_document",
      "interaction_document",
      "quotation_pdf",
    ],
  } = {},
) {
  const normalizedPurpose = String(details.purpose || "proposal").trim();
  const normalizedPurposeOther = String(details.purposeOther || "").trim();
  const hasKnownPurpose = new Set([
    "proposal",
    "request_information",
    "other",
  ]).has(normalizedPurpose);

  return {
    recipient: String(details.recipient || "").trim(),
    toAdditional: Array.isArray(details.toAdditional)
      ? details.toAdditional
          .map((entry) => String(entry || "").trim())
          .filter(Boolean)
      : String(details.toAdditional || "")
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean),
    cc: String(details.cc || "").trim(),
    subject: String(details.subject || "").trim(),
    purpose: hasKnownPurpose
      ? normalizedPurpose || "proposal"
      : normalizedPurpose
        ? "other"
        : "proposal",
    purposeOther: hasKnownPurpose
      ? normalizedPurposeOther
      : normalizedPurposeOther || normalizedPurpose,
    aiInstructionText: String(details.aiInstructionText || "").trim(),
    messageBody: String(details.messageBody || "").trim(),
    attachmentsNote: String(details.attachmentsNote || "").trim(),
    attachments: Array.isArray(details.attachments)
      ? details.attachments
          .map((attachment) =>
            normalizeCommercialEmailAttachment(attachment, {
              allowedSourceTypes,
            }),
          )
          .filter(Boolean)
      : [],
    markDoneOnSend: Boolean(details.markDoneOnSend),
  };
}

export function validateCommercialEmailAttachments(attachments = []) {
  if (attachments.length > COMMERCIAL_EMAIL_ATTACHMENT_MAX_FILES) {
    return `Solo puedes incluir hasta ${COMMERCIAL_EMAIL_ATTACHMENT_MAX_FILES} documentos por correo.`;
  }

  const invalidAttachment = attachments.find(
    (attachment) =>
      attachment?.mimeType &&
      !isCommercialEmailAttachmentMimeTypeAllowed(attachment.mimeType),
  );

  if (invalidAttachment) {
    return `El archivo ${invalidAttachment.fileName || "seleccionado"} no tiene un tipo permitido para envio.`;
  }

  const knownTotalBytes = attachments.reduce(
    (total, attachment) => total + Number(attachment?.byteSize || 0),
    0,
  );
  if (
    knownTotalBytes > 0 &&
    knownTotalBytes > COMMERCIAL_EMAIL_ATTACHMENT_MAX_TOTAL_BYTES
  ) {
    return "El tamano total de adjuntos supera el limite permitido para el correo.";
  }

  return "";
}

export function normalizeCommercialLibraryFilters(filters = {}) {
  const normalizeArray = (value) => {
    if (Array.isArray(value)) {
      return value.map((entry) => String(entry || "").trim()).filter(Boolean);
    }
    return String(value || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  };

  return {
    q: String(filters?.q || "").trim(),
    manufacturerCodes: normalizeArray(filters?.manufacturerCodes),
    solutionCodes: normalizeArray(filters?.solutionCodes),
    technologyCodes: normalizeArray(filters?.technologyCodes),
    industryCodes: normalizeArray(filters?.industryCodes),
    sort: String(filters?.sort || "updated_desc").trim() || "updated_desc",
  };
}

function getCommercialAttachmentCatalogMeta(asset, catalogType) {
  const entries = (Array.isArray(asset?.catalogs) ? asset.catalogs : [])
    .filter((entry) => String(entry?.catalogType || "") === catalogType)
    .map((entry) => ({
      code: String(entry?.code || "").trim(),
      label: String(entry?.name || "").trim(),
    }))
    .filter((entry) => entry.code || entry.label);

  return {
    codes: entries.map((entry) => entry.code).filter(Boolean),
    labels: entries.map((entry) => entry.label).filter(Boolean),
  };
}

export async function listCommercialLibraryFilesForEmail({ user }) {
  const assetResult = await listCommercialEnablementAssets({
    user,
    filters: {
      status: "published",
      visibilityLevel: "client_safe",
      pageSize: 80,
      sort: "updated_desc",
    },
  }).catch(() => ({ items: [] }));

  const items = Array.isArray(assetResult?.items) ? assetResult.items : [];
  const details = await Promise.all(
    items.map((item) =>
      getCommercialEnablementAssetDetail({
        user,
        assetPublicId: item.publicId,
      }).catch(() => null),
    ),
  );

  return details.filter(Boolean).flatMap((asset) =>
    (asset.files || [])
      .filter(
        (file) =>
          file?.isAvailable !== false &&
          isCommercialEmailAttachmentMimeTypeAllowed(file?.mimeType),
      )
      .map((file) => {
        const manufacturer = getCommercialAttachmentCatalogMeta(
          asset,
          "manufacturer",
        );
        const solution = getCommercialAttachmentCatalogMeta(asset, "solution");
        const technology = getCommercialAttachmentCatalogMeta(
          asset,
          "technology",
        );
        const industry = getCommercialAttachmentCatalogMeta(asset, "industry");

        return {
          id: `library:${asset.publicId}:${file.publicId}`,
          sourceType: "library_file",
          sourceLabel: "Biblioteca",
          resourcePublicId: asset.publicId,
          filePublicId: file.publicId,
          fileName: file.originalFileName || file.storedFileName || "archivo",
          mimeType: file.mimeType || "application/octet-stream",
          byteSize:
            file.byteSize === null || file.byteSize === undefined
              ? null
              : Number(file.byteSize),
          title: asset.title || "Activo comercial",
          summary: asset.summary || "",
          assetTypeLabel: asset.assetTypeLabel || "",
          manufacturerCodes: manufacturer.codes,
          manufacturerLabels: manufacturer.labels,
          solutionCodes: solution.codes,
          solutionLabels: solution.labels,
          technologyCodes: technology.codes,
          technologyLabels: technology.labels,
          industryCodes: industry.codes,
          industryLabels: industry.labels,
          createdAt: file.createdAt || asset.updatedAt || asset.createdAt || "",
        };
      }),
  );
}

function getCommercialAttachmentCatalogInfo(file, catalogType) {
  if (catalogType === "manufacturer") {
    return {
      codes: Array.isArray(file?.manufacturerCodes)
        ? file.manufacturerCodes
        : [],
      labels: Array.isArray(file?.manufacturerLabels)
        ? file.manufacturerLabels
        : [],
    };
  }
  if (catalogType === "solution") {
    return {
      codes: Array.isArray(file?.solutionCodes) ? file.solutionCodes : [],
      labels: Array.isArray(file?.solutionLabels) ? file.solutionLabels : [],
    };
  }
  if (catalogType === "industry") {
    return {
      codes: Array.isArray(file?.industryCodes) ? file.industryCodes : [],
      labels: Array.isArray(file?.industryLabels) ? file.industryLabels : [],
    };
  }
  return { codes: [], labels: [] };
}

export function buildCommercialLibraryAttachmentCatalogs(libraryFiles) {
  const buildCatalog = (catalogType) => {
    const byCode = new Map();
    libraryFiles.forEach((file) => {
      const info = getCommercialAttachmentCatalogInfo(file, catalogType);
      info.codes.forEach((code, index) => {
        const normalizedCode = String(code || "").trim();
        if (!normalizedCode || byCode.has(normalizedCode)) return;
        byCode.set(normalizedCode, {
          code: normalizedCode,
          label:
            String(info.labels[index] || normalizedCode).trim() ||
            normalizedCode,
        });
      });
    });
    return Array.from(byCode.values()).sort((left, right) =>
      left.label.localeCompare(right.label, "es"),
    );
  };

  return {
    manufacturer: buildCatalog("manufacturer"),
    solution: buildCatalog("solution"),
    industry: buildCatalog("industry"),
  };
}

function buildCommercialLibraryAttachmentSearchText(file) {
  return [
    file?.fileName,
    file?.title,
    file?.summary,
    file?.assetTypeLabel,
    ...(Array.isArray(file?.manufacturerLabels) ? file.manufacturerLabels : []),
    ...(Array.isArray(file?.solutionLabels) ? file.solutionLabels : []),
    ...(Array.isArray(file?.industryLabels) ? file.industryLabels : []),
  ]
    .join(" ")
    .toLowerCase();
}

export function filterCommercialLibraryFiles(libraryFiles, rawFilters = {}) {
  const filters = normalizeCommercialLibraryFilters(rawFilters);
  const queryText = filters.q.toLowerCase();

  return libraryFiles.filter((file) => {
    if (
      queryText &&
      !buildCommercialLibraryAttachmentSearchText(file).includes(queryText)
    ) {
      return false;
    }
    if (
      filters.manufacturerCodes.length &&
      !filters.manufacturerCodes.some((code) =>
        getCommercialAttachmentCatalogInfo(file, "manufacturer").codes.includes(
          code,
        ),
      )
    ) {
      return false;
    }
    if (
      filters.solutionCodes.length &&
      !filters.solutionCodes.some((code) =>
        getCommercialAttachmentCatalogInfo(file, "solution").codes.includes(
          code,
        ),
      )
    ) {
      return false;
    }
    if (
      filters.industryCodes.length &&
      !filters.industryCodes.some((code) =>
        getCommercialAttachmentCatalogInfo(file, "industry").codes.includes(
          code,
        ),
      )
    ) {
      return false;
    }
    return true;
  });
}

export function sortCommercialLibraryFiles(
  libraryFiles,
  sort = "updated_desc",
) {
  const normalizedSort =
    String(sort || "updated_desc").trim() || "updated_desc";
  const nextFiles = [...libraryFiles];

  if (normalizedSort === "title_asc") {
    return nextFiles.sort((left, right) =>
      String(left.fileName || left.title || "").localeCompare(
        String(right.fileName || right.title || ""),
        "es",
      ),
    );
  }
  if (normalizedSort === "title_desc") {
    return nextFiles.sort((left, right) =>
      String(right.fileName || right.title || "").localeCompare(
        String(left.fileName || left.title || ""),
        "es",
      ),
    );
  }
  if (normalizedSort === "updated_asc") {
    return nextFiles.sort((left, right) =>
      String(left.createdAt || "").localeCompare(String(right.createdAt || "")),
    );
  }
  return nextFiles.sort((left, right) =>
    String(right.createdAt || "").localeCompare(String(left.createdAt || "")),
  );
}
