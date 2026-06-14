import { useEffect, useMemo, useRef, useState } from "react";
import { api, getApiErrorMessage } from "./api";
import ModalInlineHelp from "./help/ModalInlineHelp";

const INTERACTION_FILE_ACCEPT =
  ".pdf,.docx,.xlsx,.xls,.csv,.txt,.eml,.png,.jpg,.jpeg,.mp3,.wav,.m4a,.mp4";
const INTERACTION_ANALYSIS_TIMEOUT_MS = 60000;
const INTERACTION_ANALYSIS_JOB_POLL_INTERVAL_MS = 3000;
const INTERACTION_ANALYSIS_TOTAL_POLL_TIMEOUT_MS = 120000;
const LEAD_SOURCE_OPTIONS = [
  { value: "fabricante", label: "Fabricante" },
  { value: "mayorista", label: "Mayorista" },
  { value: "empresa_marketing", label: "Empresa de Marketing" },
  { value: "vendedor", label: "Vendedor" },
  { value: "campana", label: "Campaña" },
  { value: "web", label: "Web" },
  { value: "correo", label: "Correo" },
  { value: "redes", label: "Redes" },
  { value: "consultor", label: "Consultor" },
  { value: "webinar", label: "Webinar" },
  { value: "evento", label: "Evento" },
  { value: "otro", label: "Otro" },
];
const LEAD_STATUS_FILTER_OPTIONS = [
  { value: "created", label: "Creado" },
  { value: "lead_unassigned", label: "Lead no asignado" },
  { value: "lead_assigned", label: "Lead asignado" },
  { value: "lead_qualified", label: "Lead calificado" },
  { value: "lead_disqualified", label: "Lead descalificado" },
];
const LEAD_STATUS_FILTER_VALUES = LEAD_STATUS_FILTER_OPTIONS.map(
  (option) => option.value,
);

function sortLeadStatusFilters(values) {
  if (!Array.isArray(values)) return [];
  const selected = new Set(
    values
      .map((value) => String(value || "").trim())
      .filter((value) => LEAD_STATUS_FILTER_VALUES.includes(value)),
  );
  return LEAD_STATUS_FILTER_VALUES.filter((value) => selected.has(value));
}

function normalizeLeadStatusFilters(values) {
  const sorted = sortLeadStatusFilters(values);
  return sorted.length ? sorted : [...LEAD_STATUS_FILTER_VALUES];
}

function getLeadStatusFilterButtonLabel(selectedStatuses) {
  const selectedCount = normalizeLeadStatusFilters(selectedStatuses).length;
  if (selectedCount === LEAD_STATUS_FILTER_VALUES.length) {
    return "Estado: Todas";
  }
  return `Estado: ${selectedCount} seleccionado${selectedCount === 1 ? "" : "s"}`;
}

function buildPastedTextFileName(label) {
  const normalizedLabel = String(label || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${normalizedLabel || "texto-referencia"}-${timestamp}.txt`;
}

function buildPastedTextFile({ fileName, text }) {
  return new File([String(text || "")], fileName, {
    type: "text/plain",
    lastModified: Date.now(),
  });
}

function formatDate(value) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return date.toLocaleDateString("es-MX");
}

function formatCurrencyUsd(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(amount);
}

function getOptionLabel(
  optionsList,
  optionId,
  labelKeys = ["name", "full_name"],
) {
  const numericId = Number(optionId || 0);
  if (!numericId) return "";
  const option = optionsList.find((item) => Number(item.id) === numericId);
  if (!option) return "";

  for (const key of labelKeys) {
    if (option[key]) return String(option[key]);
  }

  return "";
}

function formatContactName(contactDraft, fallbackLabel) {
  const fullName = [contactDraft?.firstName, contactDraft?.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  return fullName || fallbackLabel;
}

function buildLegacySellerOption(detail) {
  if (!detail?.sellerUserId) return null;
  return {
    id: Number(detail.sellerUserId),
    full_name:
      detail?.seller?.fullName ||
      detail?.seller?.email ||
      `Usuario ${Number(detail.sellerUserId)}`,
  };
}

function buildEffectiveResolutionForm(
  resolutionForm,
  currentUser,
  commercialAssignmentPolicy = null,
  detail = null,
) {
  if (!resolutionForm) return null;

  const effectiveContactResolutions = (
    resolutionForm.contactResolutions || []
  ).map((item) => ({ ...item }));
  const effectiveOpportunityResolutions = (
    resolutionForm.opportunityResolutions || []
  ).map((item) => ({
    ...item,
    draft: item.draft ? { ...item.draft } : item.draft,
  }));

  let effectiveSellerUserId = resolutionForm.sellerUserId || "";
  let assignCurrentUserAsOwnerSeller = Boolean(
    resolutionForm.assignCurrentUserAsOwnerSeller,
  );
  const accountMode = resolutionForm.accountResolution?.mode || "ignore";

  if (accountMode === "ignore") {
    return {
      ...resolutionForm,
      sellerUserId: "",
      assignCurrentUserAsOwnerSeller: false,
      contactResolutions: effectiveContactResolutions.map((item) => ({
        ...item,
        mode: "ignore",
        contactId: "",
      })),
      opportunityResolutions: effectiveOpportunityResolutions.map((item) => ({
        ...item,
        mode: "ignore",
        opportunityId: "",
        isPrimary: false,
      })),
    };
  }

  const hasResolvedContacts = effectiveContactResolutions.some(
    (item) => item.mode !== "ignore",
  );
  const assignmentMode = commercialAssignmentPolicy?.mode || "none";
  const hasPersistedLinkedOpportunity = Boolean(
    detail?.primaryOpportunityId ||
    (Array.isArray(detail?.suggestedOpportunities)
      ? detail.suggestedOpportunities.some(
          (item) => item?.selectedOpportunityId,
        )
      : false),
  );

  if (!hasResolvedContacts) {
    effectiveSellerUserId = "";
    assignCurrentUserAsOwnerSeller = false;
  } else if (
    !effectiveSellerUserId &&
    detail?.sellerUserId &&
    hasResolvedContacts
  ) {
    effectiveSellerUserId = String(detail.sellerUserId);
    assignCurrentUserAsOwnerSeller = false;
  } else if (
    !effectiveSellerUserId &&
    hasPersistedLinkedOpportunity &&
    detail?.sellerUserId
  ) {
    effectiveSellerUserId = String(detail.sellerUserId);
    assignCurrentUserAsOwnerSeller = false;
  } else if (
    assignmentMode === "self_only" &&
    currentUser?.id &&
    (!effectiveSellerUserId ||
      Number(effectiveSellerUserId) === Number(currentUser.id))
  ) {
    effectiveSellerUserId = String(currentUser.id);
    assignCurrentUserAsOwnerSeller = true;
  } else if (
    assignCurrentUserAsOwnerSeller &&
    currentUser?.id &&
    commercialAssignmentPolicy?.currentUserIsSellerEligible
  ) {
    effectiveSellerUserId = String(currentUser.id);
  }

  if (!hasResolvedContacts || !effectiveSellerUserId) {
    for (const item of effectiveOpportunityResolutions) {
      item.mode = "ignore";
      item.opportunityId = "";
      item.isPrimary = false;
      if (item.draft) {
        item.draft.sellerUserId = "";
      }
    }
  } else {
    for (const item of effectiveOpportunityResolutions) {
      if (item.draft) {
        item.draft.sellerUserId = effectiveSellerUserId;
      }
    }
  }

  return {
    ...resolutionForm,
    sellerUserId: effectiveSellerUserId,
    assignCurrentUserAsOwnerSeller,
    contactResolutions: effectiveContactResolutions,
    opportunityResolutions: effectiveOpportunityResolutions,
  };
}

function normalizeLeadDisplayText(value) {
  const text = String(value || "");
  if (!text) return "";

  return text
    .replace(
      /\b(interacciones|interacciónes|ieracciones|ieracciónes)\b/gi,
      (match) =>
        match.charAt(0) === match.charAt(0).toUpperCase() ? "Leads" : "leads",
    )
    .replace(
      /\b(interaccion|interacción|iteraccion|iteracción)\b/gi,
      (match) =>
        match.charAt(0) === match.charAt(0).toUpperCase() ? "Lead" : "lead",
    )
    .replace(/\b[Nn]ueva\s+lead\b/g, (match) =>
      match.charAt(0) === "N" ? "Nuevo lead" : "nuevo lead",
    );
}

function buildResolveConfirmationPreview(
  detail,
  resolutionForm,
  options,
  currentUser,
) {
  const effectiveResolutionForm = buildEffectiveResolutionForm(
    resolutionForm,
    currentUser,
    detail?.commercialAssignmentPolicy,
    detail,
  );
  if (!detail || !effectiveResolutionForm || !options) return null;

  const accountResolution = effectiveResolutionForm.accountResolution || {};
  const accountDraft = accountResolution.draft || {};
  const accountToCreate =
    accountResolution.mode === "create_new"
      ? accountDraft.name || "Nueva cuenta"
      : "";
  const accountToLink =
    accountResolution.mode === "link_existing"
      ? getOptionLabel(options.accounts || [], accountResolution.accountId)
      : "";

  const contactsToCreate = (effectiveResolutionForm.contactResolutions || [])
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.mode === "create_new")
    .map(({ item, index }) => ({
      title: formatContactName(item.draft, `Contacto ${index + 1}`),
      meta: [item.draft?.email, item.draft?.positionTitle]
        .filter(Boolean)
        .join(" · "),
    }));

  const contactsToLink = (effectiveResolutionForm.contactResolutions || [])
    .filter((item) => item.mode === "link_existing")
    .map((item) =>
      getOptionLabel(options.contacts || [], item.contactId, [
        "full_name",
        "name",
      ]),
    )
    .filter(Boolean);

  const opportunitiesToCreate = (
    effectiveResolutionForm.opportunityResolutions || []
  )
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.mode === "create_new")
    .map(({ item, index }) => ({
      title: item.draft?.name || `Oportunidad ${index + 1}`,
      meta: [
        formatCurrencyUsd(item.draft?.amountUsd),
        item.draft?.closeDate
          ? `Cierre ${formatDate(item.draft.closeDate)}`
          : "",
        getOptionLabel(options.businessLines || [], item.draft?.businessLineId),
        effectiveResolutionForm.sellerUserId
          ? `Vendedor: ${
              Number(effectiveResolutionForm.sellerUserId) ===
              Number(currentUser?.id)
                ? currentUser?.full_name || ""
                : getOptionLabel(
                    options.sellerUsers || [],
                    effectiveResolutionForm.sellerUserId,
                    ["full_name", "name"],
                  )
            }`
          : "",
        item.draft?.presalesUserId
          ? `Preventa: ${getOptionLabel(options.presalesUsers || [], item.draft.presalesUserId, ["full_name", "name"])}`
          : "",
      ]
        .filter(Boolean)
        .join(" · "),
    }));

  const opportunitiesToLink = (
    effectiveResolutionForm.opportunityResolutions || []
  )
    .filter((item) => item.mode === "link_existing")
    .map((item) =>
      getOptionLabel(options.opportunities || [], item.opportunityId),
    )
    .filter(Boolean);

  const selfAssignedSellerLabel =
    effectiveResolutionForm.assignCurrentUserAsOwnerSeller && currentUser?.id
      ? currentUser.full_name || currentUser.email || "Usuario actual"
      : "";

  const sellerToAssign = effectiveResolutionForm.sellerUserId
    ? selfAssignedSellerLabel ||
      getOptionLabel(
        effectiveResolutionForm.accountResolution.mode === "link_existing"
          ? options.sellerUsersByAccountId?.[
              String(effectiveResolutionForm.accountResolution.accountId || "")
            ] || []
          : options.sellerUsers || [],
        effectiveResolutionForm.sellerUserId,
        ["full_name", "fullName", "name"],
      )
    : "";

  const hasAccount =
    effectiveResolutionForm.accountResolution.mode === "link_existing"
      ? Boolean(effectiveResolutionForm.accountResolution.accountId)
      : effectiveResolutionForm.accountResolution.mode === "create_new"
        ? Boolean(effectiveResolutionForm.accountResolution.draft?.name)
        : false;
  const hasContacts = (effectiveResolutionForm.contactResolutions || []).some(
    (item) => item.mode !== "ignore",
  );
  const hasOpportunities = (
    effectiveResolutionForm.opportunityResolutions || []
  ).some((item) => item.mode !== "ignore");
  const targetStatus =
    !hasAccount || !hasContacts
      ? "Creado"
      : !effectiveResolutionForm.sellerUserId
        ? "Lead no asignado"
        : hasOpportunities
          ? "Lead Calificado"
          : "Lead Asignado";

  return {
    interactionTitle:
      normalizeLeadDisplayText(detail.title) || "Lead sin título",
    accountToCreate,
    accountToLink,
    contactsToCreate,
    contactsToLink,
    opportunitiesToCreate,
    opportunitiesToLink,
    sellerToAssign,
    selfAssignedSellerLabel,
    targetStatus,
    ignoredContactsCount: (
      effectiveResolutionForm.contactResolutions || []
    ).filter((item) => item.mode === "ignore").length,
    ignoredOpportunitiesCount: (
      effectiveResolutionForm.opportunityResolutions || []
    ).filter((item) => item.mode === "ignore").length,
  };
}

function isQualifiedLeadStatus(status) {
  return status === "lead_qualified";
}

function isDisqualifiedLeadStatus(status) {
  return status === "lead_disqualified";
}

function isFinalizedLeadStatus(status) {
  return isQualifiedLeadStatus(status) || isDisqualifiedLeadStatus(status);
}

function getInteractionStatusMeta(status) {
  switch (status) {
    case "lead_qualified":
      return {
        label: "Lead Calificado",
        className: "interaction-status-pill is-resolved",
        toneClassName: "interaction-summary-card is-resolved",
      };
    case "lead_unassigned":
      return {
        label: "Lead no asignado",
        className: "interaction-status-pill is-uploaded",
        toneClassName: "interaction-summary-card is-uploaded",
      };
    case "lead_assigned":
      return {
        label: "Lead Asignado",
        className: "interaction-status-pill is-analyzed",
        toneClassName: "interaction-summary-card is-analyzed",
      };
    case "lead_disqualified":
      return {
        label: "Lead Descalificado",
        className: "interaction-status-pill is-rejected",
        toneClassName: "interaction-summary-card is-uploaded",
      };
    case "created":
      return {
        label: "Creado",
        className: "interaction-status-pill is-uploaded",
        toneClassName: "interaction-summary-card is-uploaded",
      };
    default:
      return {
        label: status || "Sin estado",
        className: "interaction-status-pill",
        toneClassName: "interaction-summary-card",
      };
  }
}

function getDocumentStageLabel(status, labels = {}) {
  switch (status) {
    case "completed":
      return labels.completed || "Completada";
    case "pending":
      return labels.pending || "Pendiente";
    case "failed":
      return labels.failed || "Fallida";
    default:
      return status || "Sin estado";
  }
}

function documentNeedsTranscription(document) {
  const extension = String(document?.fileExtension || "").toLowerCase();
  const mimeType = String(document?.mimeType || "").toLowerCase();
  return (
    [".mp3", ".wav", ".m4a"].includes(extension) ||
    mimeType.startsWith("audio/")
  );
}

function getDocumentProcessingSummary(document) {
  const extractionLabel = getDocumentStageLabel(document?.extractionStatus, {
    completed: "Completada",
    pending: "Pendiente",
    failed: "Fallida",
  });

  const transcriptionLabel = documentNeedsTranscription(document)
    ? getDocumentStageLabel(document?.transcriptionStatus, {
        completed: "Completada",
        pending: "Pendiente",
        failed: "Fallida",
      })
    : "No aplica";

  return `Extracción: ${extractionLabel} | Transcripción: ${transcriptionLabel}`;
}

function buildDefaultOpportunityDraft(suggestion, options, currentUser) {
  const closeDate = new Date();
  closeDate.setDate(closeDate.getDate() + 30);
  return {
    name: suggestion?.name || "",
    contactId: "",
    amountUsd:
      suggestion?.amountUsd === null || suggestion?.amountUsd === undefined
        ? ""
        : String(suggestion.amountUsd),
    closeDate: suggestion?.closeDate || closeDate.toISOString().slice(0, 10),
    businessLineId: suggestion?.selectedBusinessLineId
      ? String(suggestion.selectedBusinessLineId)
      : options.businessLines[0]?.id
        ? String(options.businessLines[0].id)
        : "",
    sellerUserId: suggestion?.selectedSellerUserId
      ? String(suggestion.selectedSellerUserId)
      : options.currentUserIsSellerEligible && currentUser?.id
        ? String(currentUser.id)
        : options.sellerUsers[0]?.id
          ? String(options.sellerUsers[0].id)
          : "",
    presalesUserId: suggestion?.selectedPresalesUserId
      ? String(suggestion.selectedPresalesUserId)
      : options.presalesUsers[0]?.id
        ? String(options.presalesUsers[0].id)
        : "",
    summary: suggestion?.summary || "",
  };
}

function buildInitialResolutionForm(detail, options, currentUser) {
  const commercialAssignmentPolicy = detail?.commercialAssignmentPolicy || null;
  const suggestedAccount = detail?.suggestedAccount || null;
  const persistedAccountMode =
    typeof suggestedAccount?.resolutionMode === "string"
      ? suggestedAccount.resolutionMode
      : "";
  const accountResolution =
    suggestedAccount?.selectedAccountId &&
    persistedAccountMode === "link_existing"
      ? {
          mode: "link_existing",
          accountId: String(suggestedAccount.selectedAccountId),
          draft: {
            name: suggestedAccount.name || "",
            website: suggestedAccount.website || "",
            phone: suggestedAccount.phone || "",
            city: suggestedAccount.city || "",
            stateRegion: suggestedAccount.stateRegion || "",
            countryId: suggestedAccount.countryId
              ? String(suggestedAccount.countryId)
              : "",
            description: suggestedAccount.description || "",
          },
        }
      : persistedAccountMode === "ignore"
        ? {
            mode: "ignore",
            accountId: "",
            draft: {
              name: suggestedAccount?.name || "",
              website: suggestedAccount?.website || "",
              phone: suggestedAccount?.phone || "",
              city: suggestedAccount?.city || "",
              stateRegion: suggestedAccount?.stateRegion || "",
              countryId: suggestedAccount?.countryId
                ? String(suggestedAccount.countryId)
                : "",
              description:
                suggestedAccount?.description || detail?.summary || "",
            },
          }
        : suggestedAccount?.name
          ? {
              mode: "create_new",
              accountId: "",
              draft: {
                name: suggestedAccount.name || "",
                website: suggestedAccount.website || "",
                phone: suggestedAccount.phone || "",
                city: suggestedAccount.city || "",
                stateRegion: suggestedAccount.stateRegion || "",
                countryId: suggestedAccount.countryId
                  ? String(suggestedAccount.countryId)
                  : "",
                description:
                  suggestedAccount.description || detail?.summary || "",
              },
            }
          : {
              mode: "ignore",
              accountId: "",
              draft: {
                name: "",
                website: "",
                phone: "",
                city: "",
                stateRegion: "",
                countryId: "",
                description: "",
              },
            };

  const contactResolutions = (detail?.suggestedContacts || []).map(
    (contact) => {
      const persistedMode =
        typeof contact?.resolutionMode === "string"
          ? contact.resolutionMode
          : "";
      return {
        suggestionId: contact.suggestionId,
        mode:
          persistedMode === "link_existing" && contact.selectedContactId
            ? "link_existing"
            : persistedMode === "ignore"
              ? "ignore"
              : contact.fullName
                ? "create_new"
                : "ignore",
        contactId:
          persistedMode === "link_existing" && contact.selectedContactId
            ? String(contact.selectedContactId)
            : "",
        draft: {
          firstName: contact.firstName || "",
          lastName: contact.lastName || "",
          email: contact.email || "",
          phone: contact.phone || "",
          mobile: contact.mobile || "",
          positionTitle: contact.positionTitle || "",
          department: contact.department || "",
          countryId: "",
          stateRegion: "",
          city: "",
        },
      };
    },
  );

  if (!contactResolutions.length) {
    contactResolutions.push({
      suggestionId: "manual_contact_1",
      mode: "ignore",
      contactId: "",
      draft: {
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
        mobile: "",
        positionTitle: "",
        department: "",
        countryId: "",
        stateRegion: "",
        city: "",
      },
    });
  }

  const opportunityResolutions = (detail?.suggestedOpportunities || []).map(
    (opportunity, index) => {
      const persistedMode =
        typeof opportunity?.resolutionMode === "string"
          ? opportunity.resolutionMode
          : "";
      return {
        suggestionId: opportunity.suggestionId,
        mode:
          persistedMode === "link_existing" && opportunity.selectedOpportunityId
            ? "link_existing"
            : persistedMode === "ignore"
              ? "ignore"
              : detail?.sellerUserId && opportunity.name
                ? "create_new"
                : "ignore",
        opportunityId:
          persistedMode === "link_existing" && opportunity.selectedOpportunityId
            ? String(opportunity.selectedOpportunityId)
            : "",
        isPrimary: index === 0,
        draft: buildDefaultOpportunityDraft(opportunity, options, currentUser),
      };
    },
  );

  if (!opportunityResolutions.length) {
    opportunityResolutions.push({
      suggestionId: "manual_opportunity_1",
      mode: "ignore",
      opportunityId: "",
      isPrimary: true,
      draft: buildDefaultOpportunityDraft(null, options, currentUser),
    });
  }

  return {
    sellerUserId: detail?.sellerUserId
      ? String(detail.sellerUserId)
      : commercialAssignmentPolicy?.mode === "self_only" && currentUser?.id
        ? String(currentUser.id)
        : "",
    assignCurrentUserAsOwnerSeller: false,
    accountResolution,
    contactResolutions,
    opportunityResolutions,
  };
}

function buildEditableForm(detail) {
  return {
    title: detail?.title || "",
    leadSource: detail?.leadSource || "empresa_marketing",
    sourceNotes: detail?.sourceNotes || "",
    summary: detail?.summary || "",
    topics: Array.isArray(detail?.topics) ? detail.topics : [],
    actionsTaken: Array.isArray(detail?.actionsTaken)
      ? detail.actionsTaken
      : [],
    nextSteps: Array.isArray(detail?.nextSteps) ? detail.nextSteps : [],
    suggestedAccount: detail?.suggestedAccount || null,
    suggestedContacts: Array.isArray(detail?.suggestedContacts)
      ? detail.suggestedContacts
      : [],
    suggestedOpportunities: Array.isArray(detail?.suggestedOpportunities)
      ? detail.suggestedOpportunities
      : [],
  };
}

function TagEditor({ label, values, onChange, placeholder }) {
  return (
    <div className="field-group interaction-tag-editor">
      <label>{label}</label>
      <textarea
        value={values.join("\n")}
        onChange={(event) =>
          onChange(
            event.target.value
              .split("\n")
              .map((item) => item.trim())
              .filter(Boolean),
          )
        }
        placeholder={placeholder}
      />
    </div>
  );
}

function CreateInteractionModal({
  isOpen,
  onClose,
  onSubmit,
  creating,
  isUploadingFiles,
  setCreateInfoMessage,
  leadSource,
  setLeadSource,
  files,
  setFiles,
  onUploadFiles,
  pastedTextName,
  setPastedTextName,
  pastedText,
  setPastedText,
}) {
  if (!isOpen) return null;

  const handleFileChange = async (event) => {
    const nextFiles = Array.from(event.target.files || []);
    event.target.value = "";
    if (!nextFiles.length) return;

    try {
      await onUploadFiles(nextFiles);
      setFiles((currentFiles) => [...currentFiles, ...nextFiles]);
    } catch (error) {
      setCreateInfoMessage?.(
        getApiErrorMessage(error, "No fue posible subir los archivos"),
      );
    }
  };

  const handleAddPastedText = async () => {
    const trimmedText = String(pastedText || "").trim();
    if (!trimmedText) return;

    const pastedTextFile = buildPastedTextFile({
      fileName: buildPastedTextFileName(pastedTextName),
      text: trimmedText,
    });

    try {
      await onUploadFiles([pastedTextFile]);
      setFiles((currentFiles) => [...currentFiles, pastedTextFile]);
    } catch (error) {
      setCreateInfoMessage?.(
        getApiErrorMessage(error, "No fue posible subir el texto al lead"),
      );
      return;
    }
    setPastedTextName("");
    setPastedText("");
  };

  return (
    <div className="modal-overlay">
      <div
        className={`modal-dialog modal-dialog-wide interaction-modal modal-dialog-with-scroll-shell${creating ? " modal-dialog-busy" : ""}`}
        aria-busy={creating || isUploadingFiles}
      >
        <div className="modal-dialog-scroll-shell">
          <div className="modal-header interaction-modal-header-with-close">
            <button
              type="button"
              className="btn-secondary account-modal-close-button interaction-modal-close-left"
              onClick={onClose}
              disabled={creating}
              aria-label="Cerrar modal de crear lead"
              title="Cerrar"
            >
              ×
            </button>
            <div className="interaction-create-header">
              <div className="interaction-create-heading">
                <span className="interaction-create-kicker">Nuevo lead</span>
                <div className="account-modal-title-row">
                  <h3 className="modal-title">Crear lead</h3>
                  <ModalInlineHelp helpKey="lead.create" />
                </div>
              </div>
              <div className="interaction-create-header-meta">
                <span className="interaction-documents-count-badge">
                  {files.length} {files.length === 1 ? "archivo" : "archivos"}
                </span>
                <span className="interaction-documents-count-badge">
                  {pastedText.trim() ? "Texto cargado" : "Sin texto"}
                </span>
                <span className="interaction-create-format-pill">
                  PDF, Office, EML, imágenes y audio
                </span>
              </div>
            </div>
          </div>
          <fieldset
            className="interaction-detail-lock-shell"
            disabled={creating || isUploadingFiles}
          >
            <form
              className="account-create-form interaction-create-form"
              onSubmit={(event) => {
                event.preventDefault();
                onSubmit();
              }}
            >
              <section className="account-form-section account-modal-section interaction-create-dropzone-section">
                <div className="interaction-create-grid">
                  <label className="interaction-create-dropzone">
                    <input
                      type="file"
                      multiple
                      accept={INTERACTION_FILE_ACCEPT}
                      onChange={(event) => {
                        void handleFileChange(event);
                      }}
                    />
                    <span
                      className="interaction-create-dropzone-icon"
                      aria-hidden="true"
                    >
                      <svg viewBox="0 0 24 24" focusable="false">
                        <path d="M12 3.75a.75.75 0 0 1 .75.75v8.69l2.72-2.72a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 1 1 1.06-1.06l2.72 2.72V4.5a.75.75 0 0 1 .75-.75" />
                        <path d="M5.75 15.5a.75.75 0 0 1 .75.75v1.25c0 .69.56 1.25 1.25 1.25h8.5c.69 0 1.25-.56 1.25-1.25v-1.25a.75.75 0 0 1 1.5 0v1.25A2.75 2.75 0 0 1 16.25 20h-8.5A2.75 2.75 0 0 1 5 17.25v-1.25a.75.75 0 0 1 .75-.75" />
                      </svg>
                    </span>
                    <strong>Selecciona uno o varios archivos</strong>
                    <span className="interaction-create-dropzone-copy">
                      Adjunta correos, cotizaciones, minutas, audios o archivos
                      de soporte. Si prefieres, también puedes crear el lead
                      solo con texto pegado.
                    </span>
                    <span className="interaction-create-dropzone-action">
                      Elegir archivos
                    </span>
                    {files.length ? (
                      <span className="interaction-create-dropzone-selected">
                        {files.length} archivo{files.length === 1 ? "" : "s"}
                        seleccionado{files.length === 1 ? "" : "s"}
                      </span>
                    ) : null}
                    {isUploadingFiles ? (
                      <span className="interaction-create-dropzone-selected interaction-create-dropzone-selected-uploading">
                        Subiendo archivos...
                      </span>
                    ) : null}
                    <span className="interaction-create-dropzone-footnote">
                      Formatos soportados: PDF, DOCX, XLSX, XLS, CSV, TXT, EML,
                      PNG, JPG, JPEG, MP3, WAV, M4A y MP4.
                    </span>
                  </label>

                  <div className="interaction-create-guidance">
                    <div className="interaction-create-guidance-card">
                      <strong>1. Carga evidencia</strong>
                      <p>
                        Reúne los archivos que explican el contexto comercial
                        del caso.
                      </p>
                    </div>
                    <div className="interaction-create-guidance-card">
                      <strong>2. Crea el lead</strong>
                      <p>
                        El lead se guarda con la evidencia documental que
                        cargaste.
                      </p>
                    </div>
                    <div className="interaction-create-guidance-card">
                      <strong>3. Analiza y resuelve</strong>
                      <p>
                        Abre el lead y usa "Analizar documentos para llenar
                        información" antes de resolver vínculos en el CRM.
                      </p>
                    </div>
                  </div>
                </div>
              </section>

              <section className="account-form-section account-modal-section">
                <div className="field-group">
                  <label>Fuente del lead</label>
                  <select
                    value={leadSource}
                    onChange={(event) => setLeadSource(event.target.value)}
                    required
                  >
                    <option value="">Selecciona una fuente</option>
                    {LEAD_SOURCE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </section>

              <section className="account-form-section account-modal-section interaction-create-text-section">
                <div className="interaction-create-text-card">
                  <div className="interaction-create-text-card-head">
                    <div className="interaction-create-text-card-copy">
                      <span className="interaction-create-kicker">
                        Texto de referencia
                      </span>
                      <strong>Agrega más fuentes de texto al lead</strong>
                      <p className="section-helper-text interaction-create-text-card-hint">
                        Convierte correos, minutas o notas en archivos `.txt`
                        para analizarlos junto con el resto de la evidencia.
                      </p>
                    </div>
                  </div>

                  <div className="interaction-create-text-controls">
                    <div className="field-group interaction-create-text-name-field">
                      <label>Nombre del archivo de texto</label>
                      <input
                        type="text"
                        value={pastedTextName}
                        onChange={(event) =>
                          setPastedTextName(event.target.value)
                        }
                        placeholder="Ej. correo-cliente, minuta-reunion, contexto-inicial"
                      />
                    </div>
                    <div className="interaction-create-text-actions">
                      <button
                        type="button"
                        className="btn-secondary interaction-create-add-text-button"
                        onClick={handleAddPastedText}
                        disabled={creating || !String(pastedText || "").trim()}
                      >
                        Agregar texto como evidencia
                      </button>
                    </div>
                  </div>

                  <div className="interaction-create-text-grid">
                    <div className="field-group interaction-create-text-body-field">
                      <label>Pegar texto</label>
                      <textarea
                        className="interaction-create-textarea"
                        value={pastedText}
                        onChange={(event) => setPastedText(event.target.value)}
                        placeholder="Pega aquí el contenido que quieres añadir como evidencia del lead."
                      />
                    </div>
                  </div>

                  <span className="field-hint interaction-create-text-footnote">
                    Se agregará como un archivo `.txt` al repositorio del lead.
                  </span>
                </div>
              </section>

              <section className="account-form-section account-modal-section interaction-create-files-section">
                <div className="interaction-create-files-header">
                  <h4>Archivos seleccionados</h4>
                  <p className="section-helper-text">
                    Revisa aquí la evidencia que se usará para crear el lead.
                  </p>
                </div>

                {files.length ? (
                  <div className="interaction-create-files-list">
                    {files.map((file) => (
                      <div
                        key={`${file.name}-${file.size}`}
                        className="interaction-create-file-card"
                      >
                        <span className="interaction-create-file-name">
                          {file.name}
                        </span>
                        <span className="interaction-create-file-meta">
                          {Math.max(1, Math.round(file.size / 1024))} KB
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="interaction-create-empty-state">
                    Aún no has seleccionado archivos. Empieza cargando la
                    evidencia del caso.
                  </div>
                )}
              </section>
              <div className="modal-buttons">
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={creating || isUploadingFiles || !leadSource}
                >
                  {creating ? "Creando..." : "Crear lead"}
                </button>
              </div>
            </form>
          </fieldset>
        </div>
        {creating ? (
          <div
            className="modal-dialog-blocking-overlay"
            role="status"
            aria-live="polite"
          >
            <div className="modal-dialog-blocking-card">
              <span
                className="interaction-progress-spinner"
                aria-hidden="true"
              />
              <strong>Creando lead</strong>
              <span>Estamos guardando la evidencia del lead.</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function InteractionInfoModal({ message, onClose }) {
  if (!message) return null;

  return (
    <div
      className="modal-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal-dialog interaction-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Información de lead"
      >
        <div className="modal-header">
          <h3 className="modal-title">Información</h3>
        </div>
        <div className="account-form-section account-modal-section">
          <p>{message}</p>
        </div>
        <div className="modal-buttons">
          <button type="button" className="btn-primary" onClick={onClose}>
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}

function getResolveDuplicateReviewTitle(review) {
  const code = String(review?.code || "");
  if (code.startsWith("ACCOUNT_")) return "Cuenta similar detectada";
  if (code.startsWith("CONTACT_")) return "Contacto similar detectado";
  if (code.startsWith("OPPORTUNITY_")) return "Oportunidad similar detectada";
  return "Coincidencias detectadas";
}

function getResolveDuplicateReviewSourceLabel(source) {
  if (source === "ai") return "Con apoyo de IA";
  return "Con reglas internas";
}

function getResolveDuplicateCandidateKey(warning, index) {
  return String(
    warning.accountId ||
      warning.contactId ||
      warning.opportunityId ||
      warning.email ||
      warning.opportunityName ||
      warning.accountName ||
      `${index}`,
  );
}

function getResolveDuplicateCandidateTitle(warning) {
  return (
    warning.accountName ||
    warning.opportunityName ||
    warning.contactName ||
    warning.email ||
    "Registro coincidente"
  );
}

function getResolveDuplicateCandidateMeta(warning) {
  const parts = [];
  if (warning.reasonLabel) {
    parts.push(warning.reasonLabel);
  }
  if (warning.severityMessage) {
    parts.push(warning.severityMessage);
  }
  if (warning.contactName && warning.opportunityName) {
    parts.push(`Contacto relacionado: ${warning.contactName}`);
  }
  if (warning.accountName && warning.email) {
    parts.push(`Email: ${warning.email}`);
  }
  if (
    Number.isFinite(Number(warning.similarityScore)) &&
    Number(warning.similarityScore) > 0
  ) {
    parts.push(
      `Similitud estimada: ${Math.round(Number(warning.similarityScore) * 100)}%`,
    );
  }
  return parts;
}

function InteractionResolveDuplicateReview({ review, onDismiss }) {
  if (!review) return null;

  const warnings = Array.isArray(review.duplicateWarnings)
    ? review.duplicateWarnings
    : [];
  const aiSummary = String(review.duplicateReview?.summary || "").trim();
  const aiRecommendation = String(
    review.duplicateReview?.recommendation || "",
  ).trim();

  return (
    <section className="interaction-duplicate-review" aria-live="polite">
      <div className="interaction-duplicate-review-header">
        <div>
          <span className="interaction-duplicate-review-eyebrow">
            Revisa antes de guardar
          </span>
          <h4>{getResolveDuplicateReviewTitle(review)}</h4>
          <p>{review.message}</p>
        </div>
        <button
          type="button"
          className="btn-secondary interaction-duplicate-review-dismiss"
          onClick={onDismiss}
        >
          Ocultar detalle
        </button>
      </div>

      <div className="interaction-duplicate-review-tags">
        <span className="interaction-duplicate-review-tag">
          {warnings.length}{" "}
          {warnings.length === 1 ? "coincidencia" : "coincidencias"}
        </span>
        <span className="interaction-duplicate-review-tag">
          {getResolveDuplicateReviewSourceLabel(
            review.duplicateValidationSource,
          )}
        </span>
      </div>

      {review.duplicateReview ? (
        <article className="interaction-duplicate-review-ai-card">
          <strong>Resumen adicional</strong>
          {aiSummary ? <p>{aiSummary}</p> : null}
          {aiRecommendation && aiRecommendation !== aiSummary ? (
            <p className="field-hint">{aiRecommendation}</p>
          ) : null}
        </article>
      ) : null}

      <div className="interaction-duplicate-review-list">
        {warnings.map((warning, index) => {
          const meta = getResolveDuplicateCandidateMeta(warning);
          return (
            <article
              key={getResolveDuplicateCandidateKey(warning, index)}
              className="interaction-duplicate-review-card"
            >
              <strong>{getResolveDuplicateCandidateTitle(warning)}</strong>
              {meta.map((item) => (
                <p key={item} className="field-hint">
                  {item}
                </p>
              ))}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function InteractionDetailModal({
  isOpen,
  onClose,
  currentUser,
  detail,
  editForm,
  setEditForm,
  resolutionForm,
  setResolutionForm,
  options,
  resolveDuplicateReview,
  onDismissResolveDuplicateReview,
  resolving,
  reanalyzing,
  canAnalyze,
  canResolve,
  addingDocuments,
  canAddDocuments,
  deletingDocumentPublicId,
  canDeleteDocuments,
  onAddDocuments,
  onDeleteDocument,
  onResolve,
  onReanalyze,
}) {
  const [uploadInputKey, setUploadInputKey] = useState(0);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUploadInputKey((currentValue) => currentValue + 1);
  }, [detail?.id, isOpen]);

  if (!isOpen || !detail || !editForm || !resolutionForm) return null;

  const isAnalysisLocked = reanalyzing || addingDocuments || resolving;
  const analysisProgressTitle = resolving
    ? "Guardando lead"
    : reanalyzing
      ? "Reanalizando lead"
      : "Subiendo archivos";
  const analysisProgressMessage = resolving
    ? "Estamos validando duplicados y guardando los cambios del lead."
    : reanalyzing
      ? "Estamos actualizando la sinopsis, sugerencias y relaciones detectadas."
      : "Estamos cargando los archivos nuevos al lead.";

  const statusMeta = getInteractionStatusMeta(detail.analysisStatus);
  const activeAccounts = (options.accounts || []).filter(
    (account) =>
      String(account?.activation_status_code || "").trim() === "activada",
  );
  const resolvedAccountId =
    resolutionForm.accountResolution.mode === "link_existing"
      ? Number(resolutionForm.accountResolution.accountId || 0) || null
      : null;
  const availableContacts = resolvedAccountId
    ? options.contacts.filter(
        (contact) =>
          Number(contact.account_id) === resolvedAccountId &&
          String(contact?.activation_status_code || "").trim() === "activado",
      )
    : [];
  const availableOpportunities = resolvedAccountId
    ? options.opportunities.filter(
        (opportunity) => Number(opportunity.account_id) === resolvedAccountId,
      )
    : [];
  const hasPersistedLinkedOpportunity = Boolean(
    detail?.primaryOpportunityId ||
    (editForm?.suggestedOpportunities || []).some(
      (opportunity) => opportunity?.selectedOpportunityId,
    ),
  );
  const hasPersistedSellerAssignment = Boolean(detail?.sellerUserId);
  const commercialAssignmentPolicy = detail?.commercialAssignmentPolicy || {
    mode: "none",
    locked: true,
    allowedSellerUserId: null,
    reason: null,
    currentUserIsSellerEligible: false,
  };
  const canEditCommercialAssignment = commercialAssignmentPolicy.mode === "any";
  const availableSellerUsers = resolvedAccountId
    ? options.sellerUsersByAccountId?.[String(resolvedAccountId)] || []
    : canEditCommercialAssignment
      ? options.sellerUsers || []
      : [];
  const legacySellerOption = buildLegacySellerOption(detail);
  const sellerOptionList =
    legacySellerOption &&
    !availableSellerUsers.some(
      (user) => Number(user.id) === Number(legacySellerOption.id),
    )
      ? [legacySellerOption, ...availableSellerUsers]
      : availableSellerUsers;
  const commercialSellerUserId = resolutionForm.assignCurrentUserAsOwnerSeller
    ? currentUser?.id
      ? String(currentUser.id)
      : ""
    : resolutionForm.sellerUserId || "";
  const commercialSellerLabel = commercialSellerUserId
    ? Number(commercialSellerUserId) === Number(currentUser?.id)
      ? currentUser?.full_name || currentUser?.email || "Usuario actual"
      : getOptionLabel(sellerOptionList, commercialSellerUserId, [
          "full_name",
          "name",
        ])
    : "";
  const isCommercialAssignmentSelfOnly =
    commercialAssignmentPolicy.mode === "self_only";
  const currentUserIsSellerEligible = Boolean(
    commercialAssignmentPolicy.currentUserIsSellerEligible,
  );
  const showDependentResolutionSections =
    resolutionForm.accountResolution.mode !== "ignore";
  const hasResolvedSuggestedContact = resolutionForm.contactResolutions.some(
    (resolution) => resolution.mode !== "ignore",
  );
  const contactSuggestionCards = (editForm.suggestedContacts || []).length
    ? editForm.suggestedContacts
    : [
        {
          suggestionId:
            resolutionForm.contactResolutions[0]?.suggestionId ||
            "manual_contact_1",
          fullName: "Contacto manual",
          firstName: "",
          lastName: "",
          reason:
            "No se detectaron contactos en el analisis. Puedes crear uno nuevo o vincular uno existente.",
          selectedContactId: null,
          resolutionMode: null,
        },
      ];
  const opportunitySuggestionCards = (editForm.suggestedOpportunities || [])
    .length
    ? editForm.suggestedOpportunities
    : [
        {
          suggestionId:
            resolutionForm.opportunityResolutions[0]?.suggestionId ||
            "manual_opportunity_1",
          name: "Oportunidad manual",
          summary: "",
          reason:
            "No se detectaron oportunidades en el analisis. Puedes crear una nueva o vincular una existente.",
          selectedOpportunityId: null,
          resolutionMode: null,
        },
      ];
  const hasMinimumCommercialLinks = Boolean(
    resolutionForm.accountResolution.mode !== "ignore" &&
    hasResolvedSuggestedContact,
  );
  const canSelfAssignCurrentUserAsOwnerSeller = Boolean(
    canEditCommercialAssignment &&
    hasResolvedSuggestedContact &&
    currentUserIsSellerEligible &&
    ((resolutionForm.accountResolution.mode === "link_existing" &&
      resolvedAccountId &&
      availableSellerUsers.length === 0) ||
      resolutionForm.accountResolution.mode === "create_new"),
  );
  const canSelectOpportunityResolution = Boolean(
    hasMinimumCommercialLinks && commercialSellerUserId,
  );

  const handleAdditionalFileChange = async (event) => {
    const selectedFiles = Array.from(event.target.files || []);
    event.target.value = "";
    if (!selectedFiles.length || !onAddDocuments) return;

    const added = await onAddDocuments(selectedFiles);
    if (added) {
      setUploadInputKey((currentValue) => currentValue + 1);
    }
  };

  const interactionDocumentCount = Array.isArray(detail?.documents)
    ? detail.documents.length
    : 0;

  return (
    <div className="modal-overlay">
      <div
        className={`modal-dialog modal-dialog-wide interaction-modal interaction-detail-modal modal-dialog-with-scroll-shell${isAnalysisLocked ? " modal-dialog-busy" : ""}`}
        aria-busy={isAnalysisLocked}
      >
        <div className="modal-dialog-scroll-shell">
          <div className="modal-header interaction-modal-header-with-close">
            <button
              type="button"
              className="btn-secondary account-modal-close-button interaction-modal-close-left"
              onClick={onClose}
              disabled={isAnalysisLocked}
              aria-label="Cerrar modal de editar lead"
              title="Cerrar"
            >
              ×
            </button>
            <div className="interaction-detail-header-copy">
              <div className="account-modal-title-row">
                <h3 className="modal-title">
                  {normalizeLeadDisplayText(detail.title)}
                </h3>
                <ModalInlineHelp helpKey="lead.edit" />
              </div>
              <p className="roles-subtitle">
                Creada {formatDate(detail.createdAt)}
              </p>
            </div>
            <div className="interaction-detail-header-actions">
              <span className={statusMeta.className}>{statusMeta.label}</span>
            </div>
          </div>
          <fieldset
            className="interaction-detail-lock-shell"
            disabled={isAnalysisLocked}
          >
            <div className="interaction-detail-scroll">
              <section className="account-form-section account-modal-section">
                <InteractionResolveDuplicateReview
                  review={resolveDuplicateReview}
                  onDismiss={onDismissResolveDuplicateReview}
                />

                {canAddDocuments ? (
                  <div className="interaction-documents-toolbar">
                    <div className="field-group interaction-documents-upload-field">
                      <div className="interaction-documents-toolbar-head">
                        <div>
                          <label>Agregar más archivos</label>
                          <p className="field-hint interaction-documents-step-hint">
                            Selecciona los archivos para subirlos de inmediato
                            al lead.
                          </p>
                        </div>
                        <span className="interaction-documents-count-badge">
                          {interactionDocumentCount} archivo
                          {interactionDocumentCount === 1 ? "" : "s"} en el lead
                        </span>
                      </div>
                      <div className="interaction-documents-toolbar-row">
                        <input
                          key={`${detail.id}-${uploadInputKey}`}
                          type="file"
                          multiple
                          accept={INTERACTION_FILE_ACCEPT}
                          onChange={handleAdditionalFileChange}
                          disabled={addingDocuments}
                        />
                      </div>
                      <div className="interaction-documents-upload-meta">
                        <p className="field-hint interaction-documents-auto-note">
                          Luego usa "Analizar documentos para llenar
                          información" para actualizar sugerencias.
                        </p>
                        {addingDocuments ? (
                          <span className="interaction-documents-pending-note">
                            Subiendo archivos...
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="interaction-documents-grid">
                  {(detail.documents || []).map((document) => (
                    <article
                      key={document.publicId}
                      className="interaction-document-card"
                    >
                      <div className="interaction-document-card-head">
                        <div>
                          <strong>{document.originalFileName}</strong>
                          <p className="field-hint">
                            {document.detectedFormat || document.mimeType} ·{" "}
                            {Math.round((document.byteSize || 0) / 1024)} KB
                          </p>
                          <p className="field-hint">
                            {getDocumentProcessingSummary(document)}
                          </p>
                        </div>
                        {canDeleteDocuments ? (
                          <button
                            type="button"
                            className="interaction-detail-icon-btn interaction-document-delete-btn"
                            onClick={() => onDeleteDocument(document.publicId)}
                            disabled={
                              deletingDocumentPublicId === document.publicId
                            }
                            aria-label={
                              deletingDocumentPublicId === document.publicId
                                ? "Eliminando archivo"
                                : "Eliminar archivo"
                            }
                            title={
                              deletingDocumentPublicId === document.publicId
                                ? "Eliminando..."
                                : "Eliminar archivo"
                            }
                          >
                            <svg
                              viewBox="0 0 24 24"
                              focusable="false"
                              aria-hidden="true"
                            >
                              <path d="M5 7h14" />
                              <path d="M9 7V5h6v2" />
                              <path d="M8 7l1 12h6l1-12" />
                              <path d="M10 11v5" />
                              <path d="M14 11v5" />
                            </svg>
                          </button>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section className="account-form-section account-modal-section interaction-detail-section interaction-synopsis-section">
                <div className="interaction-resolution-header">
                  <div>
                    <h4>Sinopsis</h4>
                  </div>
                  {canAnalyze ? (
                    <button
                      type="button"
                      className="interaction-synopsis-analyze-btn"
                      onClick={onReanalyze}
                      disabled={isAnalysisLocked}
                      aria-label={
                        reanalyzing
                          ? "Analizando documentos para llenar información"
                          : "Analizar documentos para llenar información"
                      }
                      title={
                        reanalyzing
                          ? "Analizando documentos..."
                          : "Analizar documentos para llenar información"
                      }
                    >
                      <svg
                        viewBox="0 0 24 24"
                        focusable="false"
                        aria-hidden="true"
                      >
                        <path d="M12 4.5l1.64 3.86L17.5 10l-3.86 1.64L12 15.5l-1.64-3.86L6.5 10l3.86-1.64L12 4.5Z" />
                        <path d="M18.5 5.5l.62 1.38 1.38.62-1.38.62-.62 1.38-.62-1.38-1.38-.62 1.38-.62.62-1.38Z" />
                        <circle cx="6.2" cy="6.2" r="1" />
                        <circle cx="17.7" cy="17.7" r="1" />
                      </svg>
                      <span>
                        {reanalyzing
                          ? "Analizando documentos..."
                          : "Analizar documentos para llenar información"}
                      </span>
                    </button>
                  ) : null}
                </div>
                <div className="field-group">
                  <label>Título</label>
                  <input
                    value={editForm.title}
                    onChange={(event) =>
                      setEditForm((currentValue) => ({
                        ...currentValue,
                        title: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="field-group">
                  <label>Fuente del lead</label>
                  <select
                    value={editForm.leadSource}
                    onChange={(event) =>
                      setEditForm((currentValue) => ({
                        ...currentValue,
                        leadSource: event.target.value,
                      }))
                    }
                  >
                    {LEAD_SOURCE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-group">
                  <label>Notas iniciales</label>
                  <textarea
                    value={editForm.sourceNotes}
                    onChange={(event) =>
                      setEditForm((currentValue) => ({
                        ...currentValue,
                        sourceNotes: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="field-group">
                  <label>Resumen</label>
                  <textarea
                    value={editForm.summary}
                    onChange={(event) =>
                      setEditForm((currentValue) => ({
                        ...currentValue,
                        summary: event.target.value,
                      }))
                    }
                  />
                </div>
                <TagEditor
                  label="Temas detectados"
                  values={editForm.topics}
                  onChange={(values) =>
                    setEditForm((currentValue) => ({
                      ...currentValue,
                      topics: values,
                    }))
                  }
                  placeholder="Un tema por línea"
                />
                <TagEditor
                  label="Acciones realizadas"
                  values={editForm.actionsTaken}
                  onChange={(values) =>
                    setEditForm((currentValue) => ({
                      ...currentValue,
                      actionsTaken: values,
                    }))
                  }
                  placeholder="Una acción por línea"
                />
                <TagEditor
                  label="Próximos pasos"
                  values={editForm.nextSteps}
                  onChange={(values) =>
                    setEditForm((currentValue) => ({
                      ...currentValue,
                      nextSteps: values,
                    }))
                  }
                  placeholder="Un siguiente paso por línea"
                />
              </section>

              <section className="account-form-section account-modal-section interaction-detail-section interaction-account-suggestion-section">
                <div className="interaction-resolution-header">
                  <div>
                    <h4>Cuenta sugerida</h4>
                    <p className="field-hint">
                      Define si el lead se vincula a una cuenta existente o crea
                      una nueva.
                    </p>
                  </div>
                </div>
                <div className="interaction-resolution-grid interaction-account-suggestion-grid">
                  {(() => {
                    const isMaterializedAccountSuggestion = Boolean(
                      editForm.suggestedAccount?.selectedAccountId,
                    );

                    return (
                      <div className="field-group interaction-resolution-action-field">
                        <label>Acción</label>
                        {isMaterializedAccountSuggestion ? (
                          <div className="interaction-readonly-field interaction-readonly-field-compact">
                            <span className="interaction-readonly-pill">
                              Vincular existente
                            </span>
                          </div>
                        ) : (
                          <select
                            value={resolutionForm.accountResolution.mode}
                            onChange={(event) =>
                              setResolutionForm((currentValue) => ({
                                ...currentValue,
                                accountResolution: {
                                  ...currentValue.accountResolution,
                                  mode: event.target.value,
                                },
                              }))
                            }
                          >
                            <option value="link_existing">
                              Vincular existente
                            </option>
                            <option value="ignore">Ignorar</option>
                            <option value="create_new">Crear cuenta</option>
                          </select>
                        )}
                      </div>
                    );
                  })()}
                  {resolutionForm.accountResolution.mode === "link_existing" ? (
                    <div className="field-group interaction-grid-span-2 interaction-account-existing-field">
                      <label>Cuenta existente</label>
                      {Boolean(editForm.suggestedAccount?.selectedAccountId) ? (
                        <div className="interaction-readonly-field interaction-readonly-link-field">
                          <span className="interaction-readonly-value-title">
                            {getOptionLabel(
                              activeAccounts,
                              resolutionForm.accountResolution.accountId,
                              ["name"],
                            ) || "Cuenta vinculada"}
                          </span>
                          <span className="interaction-readonly-value-subtitle">
                            Vinculo materializado desde este lead
                          </span>
                        </div>
                      ) : (
                        <select
                          value={resolutionForm.accountResolution.accountId}
                          onChange={(event) =>
                            setResolutionForm((currentValue) => ({
                              ...currentValue,
                              accountResolution: {
                                ...currentValue.accountResolution,
                                accountId: event.target.value,
                              },
                            }))
                          }
                        >
                          <option value="">Selecciona cuenta</option>
                          {activeAccounts.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  ) : null}
                  {Boolean(editForm.suggestedAccount?.selectedAccountId) ? (
                    <div className="field-group interaction-materialized-hint-field">
                      <span className="field-hint">
                        Esta sugerencia ya genero una cuenta y no puede
                        modificarse desde este lead.
                      </span>
                    </div>
                  ) : null}
                  {resolutionForm.accountResolution.mode !== "link_existing" ? (
                    <div className="field-group interaction-account-name-field">
                      <label>Nombre</label>
                      <input
                        value={resolutionForm.accountResolution.draft.name}
                        onChange={(event) =>
                          setResolutionForm((currentValue) => ({
                            ...currentValue,
                            accountResolution: {
                              ...currentValue.accountResolution,
                              draft: {
                                ...currentValue.accountResolution.draft,
                                name: event.target.value,
                              },
                            },
                          }))
                        }
                      />
                    </div>
                  ) : null}
                  {resolutionForm.accountResolution.mode !== "link_existing" ? (
                    <>
                      <div className="field-group">
                        <label>Website</label>
                        <input
                          value={resolutionForm.accountResolution.draft.website}
                          onChange={(event) =>
                            setResolutionForm((currentValue) => ({
                              ...currentValue,
                              accountResolution: {
                                ...currentValue.accountResolution,
                                draft: {
                                  ...currentValue.accountResolution.draft,
                                  website: event.target.value,
                                },
                              },
                            }))
                          }
                        />
                      </div>
                      <div className="field-group">
                        <label>Teléfono</label>
                        <input
                          value={resolutionForm.accountResolution.draft.phone}
                          onChange={(event) =>
                            setResolutionForm((currentValue) => ({
                              ...currentValue,
                              accountResolution: {
                                ...currentValue.accountResolution,
                                draft: {
                                  ...currentValue.accountResolution.draft,
                                  phone: event.target.value,
                                },
                              },
                            }))
                          }
                        />
                      </div>
                    </>
                  ) : null}
                </div>
              </section>

              {showDependentResolutionSections ? (
                <>
                  <section className="account-form-section account-modal-section interaction-detail-section interaction-contact-suggestion-section interaction-commercial-assignment-section">
                    <h4>Contactos sugeridos</h4>
                    {contactSuggestionCards.map((contact, index) => {
                      const resolution =
                        resolutionForm.contactResolutions[index];
                      if (!resolution) return null;
                      const isMaterializedContactSuggestion = Boolean(
                        contact.selectedContactId &&
                        String(contact?.resolutionMode || "").trim() ===
                          "link_existing",
                      );
                      const hasExistingContactOptions =
                        Boolean(resolvedAccountId) &&
                        availableContacts.length > 0;
                      const displayedContactMode =
                        isMaterializedContactSuggestion
                          ? "link_existing"
                          : resolution.mode === "link_existing" &&
                              !hasExistingContactOptions
                            ? "ignore"
                            : resolution.mode;
                      return (
                        <article
                          key={contact.suggestionId}
                          className="interaction-resolution-card"
                        >
                          <div className="interaction-resolution-card-head">
                            <strong>
                              {contact.fullName ||
                                `${contact.firstName} ${contact.lastName}`.trim() ||
                                "Contacto"}
                            </strong>
                            <span className="field-hint">
                              {contact.reason || "Sugerido por análisis"}
                            </span>
                          </div>
                          <div className="interaction-resolution-grid interaction-contact-suggestion-grid">
                            <div className="field-group interaction-resolution-action-field">
                              <label>Acción</label>
                              {isMaterializedContactSuggestion ? (
                                <div className="interaction-readonly-field interaction-readonly-field-compact">
                                  <span className="interaction-readonly-pill">
                                    Vincular existente
                                  </span>
                                </div>
                              ) : (
                                <select
                                  value={displayedContactMode}
                                  onChange={(event) =>
                                    setResolutionForm((prev) => ({
                                      ...prev,
                                      contactResolutions:
                                        prev.contactResolutions.map(
                                          (item, itemIndex) =>
                                            itemIndex === index
                                              ? {
                                                  ...item,
                                                  mode: event.target.value,
                                                }
                                              : item,
                                        ),
                                    }))
                                  }
                                >
                                  <option
                                    value="link_existing"
                                    disabled={!hasExistingContactOptions}
                                  >
                                    Vincular existente
                                  </option>
                                  <option value="ignore">Ignorar</option>
                                  <option value="create_new">
                                    Crear contacto
                                  </option>
                                </select>
                              )}
                            </div>
                            {displayedContactMode === "link_existing" ? (
                              <div className="field-group interaction-grid-span-2 interaction-contact-existing-field">
                                <label>Contacto existente</label>
                                {isMaterializedContactSuggestion ? (
                                  <div className="interaction-readonly-field interaction-readonly-link-field">
                                    <span className="interaction-readonly-value-title">
                                      {getOptionLabel(
                                        availableContacts,
                                        resolution.contactId,
                                        ["full_name", "name"],
                                      ) || "Contacto vinculado"}
                                    </span>
                                    <span className="interaction-readonly-value-subtitle">
                                      Vinculo materializado desde este lead
                                    </span>
                                  </div>
                                ) : (
                                  <select
                                    value={resolution.contactId}
                                    onChange={(event) =>
                                      setResolutionForm((prev) => ({
                                        ...prev,
                                        contactResolutions:
                                          prev.contactResolutions.map(
                                            (item, itemIndex) =>
                                              itemIndex === index
                                                ? {
                                                    ...item,
                                                    contactId:
                                                      event.target.value,
                                                  }
                                                : item,
                                          ),
                                      }))
                                    }
                                  >
                                    <option value="">
                                      Selecciona contacto
                                    </option>
                                    {availableContacts.map((option) => (
                                      <option key={option.id} value={option.id}>
                                        {option.full_name}
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </div>
                            ) : null}
                            {isMaterializedContactSuggestion ? (
                              <div className="field-group interaction-materialized-hint-field">
                                <span className="field-hint">
                                  Esta sugerencia ya genero un contacto y no
                                  puede modificarse desde este lead.
                                </span>
                              </div>
                            ) : null}
                            {resolution.mode !== "link_existing" ? (
                              <>
                                <div className="field-group interaction-contact-name-field">
                                  <label>Nombre</label>
                                  <input
                                    value={resolution.draft.firstName}
                                    onChange={(event) =>
                                      setResolutionForm((prev) => ({
                                        ...prev,
                                        contactResolutions:
                                          prev.contactResolutions.map(
                                            (item, itemIndex) =>
                                              itemIndex === index
                                                ? {
                                                    ...item,
                                                    draft: {
                                                      ...item.draft,
                                                      firstName:
                                                        event.target.value,
                                                    },
                                                  }
                                                : item,
                                          ),
                                      }))
                                    }
                                  />
                                </div>
                                <div className="field-group">
                                  <label>Apellido</label>
                                  <input
                                    value={resolution.draft.lastName}
                                    onChange={(event) =>
                                      setResolutionForm((prev) => ({
                                        ...prev,
                                        contactResolutions:
                                          prev.contactResolutions.map(
                                            (item, itemIndex) =>
                                              itemIndex === index
                                                ? {
                                                    ...item,
                                                    draft: {
                                                      ...item.draft,
                                                      lastName:
                                                        event.target.value,
                                                    },
                                                  }
                                                : item,
                                          ),
                                      }))
                                    }
                                  />
                                </div>
                                <div className="field-group">
                                  <label>Email</label>
                                  <input
                                    value={resolution.draft.email}
                                    onChange={(event) =>
                                      setResolutionForm((prev) => ({
                                        ...prev,
                                        contactResolutions:
                                          prev.contactResolutions.map(
                                            (item, itemIndex) =>
                                              itemIndex === index
                                                ? {
                                                    ...item,
                                                    draft: {
                                                      ...item.draft,
                                                      email: event.target.value,
                                                    },
                                                  }
                                                : item,
                                          ),
                                      }))
                                    }
                                  />
                                </div>
                                <div className="field-group">
                                  <label>Cargo</label>
                                  <input
                                    value={resolution.draft.positionTitle}
                                    onChange={(event) =>
                                      setResolutionForm((prev) => ({
                                        ...prev,
                                        contactResolutions:
                                          prev.contactResolutions.map(
                                            (item, itemIndex) =>
                                              itemIndex === index
                                                ? {
                                                    ...item,
                                                    draft: {
                                                      ...item.draft,
                                                      positionTitle:
                                                        event.target.value,
                                                    },
                                                  }
                                                : item,
                                          ),
                                      }))
                                    }
                                  />
                                </div>
                              </>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}
                  </section>

                  <section className="account-form-section account-modal-section interaction-detail-section interaction-contact-suggestion-section">
                    <div className="interaction-resolution-header">
                      <div>
                        <h4>Asignación comercial</h4>
                        <p className="field-hint">
                          {canEditCommercialAssignment
                            ? "Puedes asignar cualquier vendedor activo."
                            : "El vendedor debe ser uno de los owners vendedores de la cuenta vinculada."}
                        </p>
                      </div>
                    </div>
                    <div className="interaction-resolution-grid interaction-contact-suggestion-grid interaction-commercial-assignment-grid">
                      <div className="field-group interaction-grid-span-2">
                        <label>Vendedor asignado</label>
                        {canEditCommercialAssignment ? (
                          <>
                            <select
                              value={resolutionForm.sellerUserId || ""}
                              onChange={(event) =>
                                setResolutionForm((prev) => ({
                                  ...prev,
                                  sellerUserId: event.target.value,
                                  assignCurrentUserAsOwnerSeller: false,
                                }))
                              }
                              disabled={!hasMinimumCommercialLinks}
                            >
                              {!hasPersistedLinkedOpportunity &&
                              !hasPersistedSellerAssignment ? (
                                <option value="">Sin asignar</option>
                              ) : null}
                              {sellerOptionList.map((user) => (
                                <option key={user.id} value={user.id}>
                                  {user.full_name}
                                </option>
                              ))}
                            </select>
                            {!hasMinimumCommercialLinks ? (
                              <span className="field-hint">
                                Vincula cuenta y al menos un contacto para poder
                                asignar vendedor.
                              </span>
                            ) : hasPersistedLinkedOpportunity ? (
                              <span className="field-hint">
                                Este lead ya tiene una oportunidad vinculada,
                                por lo que no puede quedar sin vendedor
                                asignado.
                              </span>
                            ) : canSelfAssignCurrentUserAsOwnerSeller ? (
                              <>
                                <label className="interaction-primary-checkbox">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(
                                      resolutionForm.assignCurrentUserAsOwnerSeller,
                                    )}
                                    onChange={(event) =>
                                      setResolutionForm((prev) => ({
                                        ...prev,
                                        assignCurrentUserAsOwnerSeller:
                                          event.target.checked,
                                        sellerUserId: event.target.checked
                                          ? String(currentUser.id)
                                          : "",
                                      }))
                                    }
                                  />
                                  <span className="interaction-primary-checkbox-text">
                                    {resolutionForm.accountResolution.mode ===
                                    "create_new"
                                      ? "Asignarme como owner vendedor de la nueva cuenta"
                                      : "Asignarme como owner vendedor de esta cuenta"}
                                  </span>
                                </label>
                                <span className="field-hint">
                                  {resolutionForm.accountResolution.mode ===
                                  "create_new"
                                    ? "Al guardar, se te asignará explícitamente como owner vendedor para poder continuar con la oportunidad."
                                    : "La cuenta no tiene owners vendedores. Si continúas, se te agregará explícitamente como owner vendedor para poder vincular la oportunidad."}
                                </span>
                              </>
                            ) : !availableSellerUsers.length ? (
                              <span className="field-hint">
                                La cuenta no tiene owners con rol de vendedor.
                              </span>
                            ) : null}
                          </>
                        ) : isCommercialAssignmentSelfOnly ? (
                          <>
                            <div className="interaction-readonly-value">
                              {detail?.seller?.fullName ||
                                detail?.seller?.email ||
                                currentUser?.full_name ||
                                currentUser?.email ||
                                "Usuario actual"}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="interaction-readonly-value">
                              {detail?.seller?.fullName ||
                                detail?.seller?.email ||
                                "Sin asignar"}
                            </div>
                            <span className="field-hint">
                              No tienes permiso para modificar la asignacion
                              comercial del lead.
                            </span>
                          </>
                        )}
                      </div>
                      {hasMinimumCommercialLinks &&
                      hasPersistedSellerAssignment ? (
                        <div className="field-group interaction-materialized-hint-field">
                          <span className="field-hint">
                            Este lead ya tiene vendedor asignado y no puede
                            quedar sin vendedor desde este modal.
                          </span>
                        </div>
                      ) : null}
                      {isCommercialAssignmentSelfOnly ? (
                        <div className="field-group interaction-materialized-hint-field">
                          <span className="field-hint">
                            {detail?.sellerUserId
                              ? "Este lead solo admite tu propia asignacion comercial y ya no puede modificarse."
                              : hasMinimumCommercialLinks
                                ? "Al guardar, este lead se asignara automaticamente a ti."
                                : "Vincula cuenta y al menos un contacto para que el lead se asigne automaticamente a ti al guardar."}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </section>

                  {hasResolvedSuggestedContact ? (
                    <section className="account-form-section account-modal-section interaction-detail-section interaction-opportunity-suggestion-section">
                      <h4>Oportunidades sugeridas</h4>
                      <p className="field-hint">
                        Si la oportunidad ya existe en la cuenta, usa "Vincular
                        existente" para mantener la trazabilidad del lead hacia
                        la oportunidad ya creada.
                      </p>
                      {availableOpportunities.length ? (
                        <p className="field-hint">
                          La cuenta vinculada tiene{" "}
                          {availableOpportunities.length} oportunidad
                          {availableOpportunities.length === 1 ? "" : "es"}{" "}
                          disponibles para vincular.
                        </p>
                      ) : null}
                      {opportunitySuggestionCards.map((opportunity, index) => {
                        const resolution =
                          resolutionForm.opportunityResolutions[index];
                        if (!resolution) return null;
                        const isMaterializedOpportunitySuggestion = Boolean(
                          opportunity.selectedOpportunityId,
                        );
                        const hasExistingOpportunityOptions =
                          availableOpportunities.length > 0;
                        const displayedOpportunityMode =
                          isMaterializedOpportunitySuggestion
                            ? "link_existing"
                            : canSelectOpportunityResolution
                              ? resolution.mode
                              : "ignore";
                        return (
                          <article
                            key={opportunity.suggestionId}
                            className="interaction-resolution-card"
                          >
                            <div className="interaction-resolution-card-head interaction-resolution-card-head-split">
                              <div>
                                <strong>
                                  {opportunity.name ||
                                    `Oportunidad ${index + 1}`}
                                </strong>
                                <p className="field-hint">
                                  {opportunity.reason ||
                                    "Sugerida por análisis"}
                                </p>
                              </div>
                            </div>
                            <div className="interaction-resolution-grid interaction-opportunity-suggestion-grid">
                              <div className="field-group interaction-resolution-action-field">
                                <label>Acción</label>
                                {isMaterializedOpportunitySuggestion ? (
                                  <div className="interaction-readonly-field interaction-readonly-field-compact">
                                    <span className="interaction-readonly-pill">
                                      Vincular existente
                                    </span>
                                  </div>
                                ) : (
                                  <select
                                    value={displayedOpportunityMode}
                                    onChange={(event) =>
                                      setResolutionForm((prev) => ({
                                        ...prev,
                                        opportunityResolutions:
                                          prev.opportunityResolutions.map(
                                            (item, itemIndex) =>
                                              itemIndex === index
                                                ? {
                                                    ...item,
                                                    mode: event.target.value,
                                                  }
                                                : item,
                                          ),
                                      }))
                                    }
                                    disabled={!canSelectOpportunityResolution}
                                  >
                                    <option
                                      value="link_existing"
                                      disabled={!hasExistingOpportunityOptions}
                                    >
                                      Vincular existente (recomendado)
                                    </option>
                                    <option value="ignore">Ignorar</option>
                                    <option value="create_new">
                                      Crear oportunidad
                                    </option>
                                  </select>
                                )}
                                {!canSelectOpportunityResolution ? (
                                  <span className="field-hint">
                                    El vendedor de la oportunidad se define en
                                    Asignación comercial.
                                  </span>
                                ) : null}
                              </div>
                              {displayedOpportunityMode === "link_existing" ? (
                                <div className="field-group interaction-grid-span-3 interaction-opportunity-existing-field">
                                  <label>Oportunidad existente</label>
                                  {isMaterializedOpportunitySuggestion ? (
                                    <div className="interaction-readonly-field interaction-readonly-link-field">
                                      <span className="interaction-readonly-value-title">
                                        {getOptionLabel(
                                          availableOpportunities,
                                          resolution.opportunityId,
                                          ["name"],
                                        ) || "Oportunidad vinculada"}
                                      </span>
                                      <span className="interaction-readonly-value-subtitle">
                                        Vinculo materializado desde este lead
                                      </span>
                                    </div>
                                  ) : (
                                    <select
                                      value={resolution.opportunityId}
                                      onChange={(event) =>
                                        setResolutionForm((prev) => ({
                                          ...prev,
                                          opportunityResolutions:
                                            prev.opportunityResolutions.map(
                                              (item, itemIndex) =>
                                                itemIndex === index
                                                  ? {
                                                      ...item,
                                                      opportunityId:
                                                        event.target.value,
                                                    }
                                                  : item,
                                            ),
                                        }))
                                      }
                                    >
                                      <option value="">
                                        Selecciona oportunidad
                                      </option>
                                      {availableOpportunities.map((option) => (
                                        <option
                                          key={option.id}
                                          value={option.id}
                                        >
                                          {option.name}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                </div>
                              ) : null}
                              {isMaterializedOpportunitySuggestion ? (
                                <div className="field-group interaction-materialized-hint-field">
                                  <span className="field-hint">
                                    Esta sugerencia ya genero una oportunidad y
                                    no puede modificarse desde este lead.
                                  </span>
                                </div>
                              ) : null}
                              {displayedOpportunityMode === "create_new" ? (
                                <>
                                  <div className="field-group interaction-grid-span-3 interaction-opportunity-name-field">
                                    <label>Nombre</label>
                                    <input
                                      value={resolution.draft.name}
                                      onChange={(event) =>
                                        setResolutionForm((prev) => ({
                                          ...prev,
                                          opportunityResolutions:
                                            prev.opportunityResolutions.map(
                                              (item, itemIndex) =>
                                                itemIndex === index
                                                  ? {
                                                      ...item,
                                                      draft: {
                                                        ...item.draft,
                                                        name: event.target
                                                          .value,
                                                      },
                                                    }
                                                  : item,
                                            ),
                                        }))
                                      }
                                    />
                                  </div>
                                  <div className="field-group">
                                    <label>Monto USD</label>
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={resolution.draft.amountUsd}
                                      onChange={(event) =>
                                        setResolutionForm((prev) => ({
                                          ...prev,
                                          opportunityResolutions:
                                            prev.opportunityResolutions.map(
                                              (item, itemIndex) =>
                                                itemIndex === index
                                                  ? {
                                                      ...item,
                                                      draft: {
                                                        ...item.draft,
                                                        amountUsd:
                                                          event.target.value,
                                                      },
                                                    }
                                                  : item,
                                            ),
                                        }))
                                      }
                                    />
                                  </div>
                                  <div className="field-group">
                                    <label>Fecha estimada de cierre</label>
                                    <input
                                      type="date"
                                      value={resolution.draft.closeDate}
                                      onChange={(event) =>
                                        setResolutionForm((prev) => ({
                                          ...prev,
                                          opportunityResolutions:
                                            prev.opportunityResolutions.map(
                                              (item, itemIndex) =>
                                                itemIndex === index
                                                  ? {
                                                      ...item,
                                                      draft: {
                                                        ...item.draft,
                                                        closeDate:
                                                          event.target.value,
                                                      },
                                                    }
                                                  : item,
                                            ),
                                        }))
                                      }
                                    />
                                  </div>
                                  <div className="field-group">
                                    <label>Línea de negocio</label>
                                    <select
                                      value={resolution.draft.businessLineId}
                                      onChange={(event) =>
                                        setResolutionForm((prev) => ({
                                          ...prev,
                                          opportunityResolutions:
                                            prev.opportunityResolutions.map(
                                              (item, itemIndex) =>
                                                itemIndex === index
                                                  ? {
                                                      ...item,
                                                      draft: {
                                                        ...item.draft,
                                                        businessLineId:
                                                          event.target.value,
                                                      },
                                                    }
                                                  : item,
                                            ),
                                        }))
                                      }
                                    >
                                      <option value="">Selecciona línea</option>
                                      {options.businessLines.map((line) => (
                                        <option key={line.id} value={line.id}>
                                          {line.name}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className="field-group">
                                    <label>Vendedor</label>
                                    <input
                                      value={commercialSellerLabel}
                                      disabled
                                      placeholder="El vendedor de la oportunidad se define en Asignación comercial"
                                    />
                                  </div>
                                  <div className="field-group">
                                    <label>Preventa</label>
                                    <select
                                      value={resolution.draft.presalesUserId}
                                      onChange={(event) =>
                                        setResolutionForm((prev) => ({
                                          ...prev,
                                          opportunityResolutions:
                                            prev.opportunityResolutions.map(
                                              (item, itemIndex) =>
                                                itemIndex === index
                                                  ? {
                                                      ...item,
                                                      draft: {
                                                        ...item.draft,
                                                        presalesUserId:
                                                          event.target.value,
                                                      },
                                                    }
                                                  : item,
                                            ),
                                        }))
                                      }
                                    >
                                      <option value="">Sin preventa</option>
                                      {options.presalesUsers.map((user) => (
                                        <option key={user.id} value={user.id}>
                                          {user.full_name}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                </>
                              ) : null}
                            </div>
                          </article>
                        );
                      })}
                    </section>
                  ) : null}
                </>
              ) : null}
            </div>

            <div className="modal-buttons interaction-detail-modal-buttons">
              {canResolve ? (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={onResolve}
                  disabled={resolving}
                >
                  {resolving ? "Guardando..." : "Guardar lead"}
                </button>
              ) : null}
            </div>
          </fieldset>
        </div>
        {isAnalysisLocked ? (
          <div
            className="modal-dialog-blocking-overlay"
            role="status"
            aria-live="polite"
          >
            <div className="modal-dialog-blocking-card">
              <span
                className="interaction-progress-spinner"
                aria-hidden="true"
              />
              <strong>{analysisProgressTitle}</strong>
              <span>{analysisProgressMessage}</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ResolveInteractionConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  resolving,
  preview,
}) {
  if (!isOpen || !preview) return null;

  const hasRecordsToCreate = Boolean(
    preview.accountToCreate ||
    preview.contactsToCreate.length ||
    preview.opportunitiesToCreate.length,
  );
  const hasLinks = Boolean(
    preview.accountToLink ||
    preview.contactsToLink.length ||
    preview.opportunitiesToLink.length,
  );

  return (
    <div
      className="modal-overlay modal-overlay-elevated"
      onClick={(event) => {
        if (event.target === event.currentTarget && !resolving) onClose();
      }}
    >
      <div className="modal-dialog resolve-confirmation-modal">
        <div className="modal-header">
          <div>
            <h3 className="modal-title">Confirmar cambios del lead</h3>
            <p className="roles-subtitle resolve-confirmation-subtitle">
              Revisa lo que se aplicará al lead {preview.interactionTitle}.
            </p>
          </div>
        </div>

        <div className="resolve-confirmation-body">
          {hasRecordsToCreate ? (
            <section className="resolve-confirmation-section">
              <h4>Se crearán</h4>
              <div className="resolve-confirmation-list">
                {preview.accountToCreate ? (
                  <article className="resolve-confirmation-item">
                    <strong>Cuenta: {preview.accountToCreate}</strong>
                  </article>
                ) : null}
                {preview.contactsToCreate.map((contact) => (
                  <article
                    key={`create-contact-${contact.title}-${contact.meta}`}
                    className="resolve-confirmation-item"
                  >
                    <strong>Contacto: {contact.title}</strong>
                    {contact.meta ? <span>{contact.meta}</span> : null}
                  </article>
                ))}
                {preview.opportunitiesToCreate.map((opportunity) => (
                  <article
                    key={`create-opportunity-${opportunity.title}-${opportunity.meta}`}
                    className="resolve-confirmation-item"
                  >
                    <strong>Oportunidad: {opportunity.title}</strong>
                    {opportunity.meta ? <span>{opportunity.meta}</span> : null}
                  </article>
                ))}
              </div>
            </section>
          ) : (
            <section className="resolve-confirmation-section">
              <h4>Se crearán</h4>
              <p className="field-hint resolve-confirmation-empty-state">
                No se crearán registros nuevos con la configuración actual.
              </p>
            </section>
          )}

          {hasLinks ? (
            <section className="resolve-confirmation-section">
              <h4>También se vincularán</h4>
              <div className="resolve-confirmation-list">
                {preview.accountToLink ? (
                  <article className="resolve-confirmation-item">
                    <strong>Cuenta existente: {preview.accountToLink}</strong>
                  </article>
                ) : null}
                {preview.contactsToLink.map((contactName) => (
                  <article
                    key={`link-contact-${contactName}`}
                    className="resolve-confirmation-item"
                  >
                    <strong>Contacto existente: {contactName}</strong>
                  </article>
                ))}
                {preview.opportunitiesToLink.map((opportunityName) => (
                  <article
                    key={`link-opportunity-${opportunityName}`}
                    className="resolve-confirmation-item"
                  >
                    <strong>Oportunidad existente: {opportunityName}</strong>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <section className="resolve-confirmation-section">
            <h4>Estado resultante</h4>
            <div className="resolve-confirmation-list">
              <article className="resolve-confirmation-item">
                <strong>{preview.targetStatus}</strong>
                {preview.sellerToAssign ? (
                  <span>Vendedor: {preview.sellerToAssign}</span>
                ) : null}
              </article>
            </div>
          </section>

          {preview.ignoredContactsCount || preview.ignoredOpportunitiesCount ? (
            <section className="resolve-confirmation-section">
              <h4>Sugerencias ignoradas</h4>
              <p className="field-hint resolve-confirmation-empty-state">
                {preview.ignoredContactsCount
                  ? `${preview.ignoredContactsCount} contacto${preview.ignoredContactsCount === 1 ? "" : "s"}`
                  : ""}
                {preview.ignoredContactsCount &&
                preview.ignoredOpportunitiesCount
                  ? " · "
                  : ""}
                {preview.ignoredOpportunitiesCount
                  ? `${preview.ignoredOpportunitiesCount} oportunidad${preview.ignoredOpportunitiesCount === 1 ? "" : "es"}`
                  : ""}
              </p>
            </section>
          ) : null}
        </div>

        <div className="modal-buttons">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={resolving}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={onConfirm}
            disabled={resolving}
          >
            {resolving ? "Guardando..." : "Confirmar y guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function InteractionsPage({ can, currentUser }) {
  const helpRef = useRef(null);
  const interactionMenuRef = useRef(null);
  const statusFilterRef = useRef(null);
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [statusFilters, setStatusFilters] = useState([
    ...LEAD_STATUS_FILTER_VALUES,
  ]);
  const [statusFilterMenuOpen, setStatusFilterMenuOpen] = useState(false);
  const [statusFilterDraft, setStatusFilterDraft] = useState([
    ...LEAD_STATUS_FILTER_VALUES,
  ]);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createInfoMessage, setCreateInfoMessage] = useState("");
  const [creating, setCreating] = useState(false);
  const [createFiles, setCreateFiles] = useState([]);
  const [createLeadSource, setCreateLeadSource] = useState("");
  const [createPastedTextName, setCreatePastedTextName] = useState("");
  const [createPastedText, setCreatePastedText] = useState("");
  const [createUploadSessionPublicId, setCreateUploadSessionPublicId] =
    useState("");
  const [createUploadingFilesCount, setCreateUploadingFilesCount] = useState(0);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [detail, setDetail] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [resolutionForm, setResolutionForm] = useState(null);
  const [options, setOptions] = useState({
    accounts: [],
    contacts: [],
    opportunities: [],
    businessLines: [],
    sellerUsers: [],
    sellerUsersByAccountId: {},
    presalesUsers: [],
    currentUserIsSellerEligible: false,
  });
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [addingDocuments, setAddingDocuments] = useState(false);
  const [deletingDocumentPublicId, setDeletingDocumentPublicId] = useState("");
  const [deletingInteractionId, setDeletingInteractionId] = useState(null);
  const [openInteractionMenuId, setOpenInteractionMenuId] = useState(null);
  const [showResolveConfirmation, setShowResolveConfirmation] = useState(false);
  const [resolveDuplicateReview, setResolveDuplicateReview] = useState(null);
  const interactionAnalysisPollingTokenRef = useRef(0);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const canCreate = can("interacciones.create");
  const canUpdate = can("interacciones.update");
  const canAnalyze = can("interacciones.analyze");
  const canResolve = can("interacciones.resolve");
  const resolveConfirmationPreview = useMemo(
    () =>
      buildResolveConfirmationPreview(
        detail,
        resolutionForm,
        options,
        currentUser,
      ),
    [detail, resolutionForm, options, currentUser],
  );

  function closeDetailModal() {
    setShowResolveConfirmation(false);
    setResolveDuplicateReview(null);
    setShowDetailModal(false);
  }

  async function ensureCreateUploadSession() {
    if (createUploadSessionPublicId) {
      return createUploadSessionPublicId;
    }

    const { data } = await api.post(
      "/api/interactions/document-upload-sessions",
    );
    const nextSessionPublicId = String(data?.session?.publicId || "").trim();
    if (!nextSessionPublicId) {
      throw new Error("No fue posible crear la sesion documental del lead");
    }

    setCreateUploadSessionPublicId(nextSessionPublicId);
    return nextSessionPublicId;
  }

  async function uploadCreateFilesToSession(filesToUpload) {
    const nextFiles = Array.isArray(filesToUpload) ? filesToUpload : [];
    if (!nextFiles.length) return null;

    const sessionPublicId = await ensureCreateUploadSession();
    const formData = new FormData();
    nextFiles.forEach((file) => formData.append("files", file));

    setCreateUploadingFilesCount(
      (currentCount) => currentCount + nextFiles.length,
    );
    try {
      const { data } = await api.post(
        `/api/interactions/document-upload-sessions/${sessionPublicId}/files`,
        formData,
        {
          headers: { "Content-Type": "multipart/form-data" },
          timeout: 120000,
        },
      );
      return data;
    } finally {
      setCreateUploadingFilesCount((currentCount) =>
        Math.max(0, currentCount - nextFiles.length),
      );
    }
  }

  function openResolveConfirmation() {
    if (!detail || !editForm || !resolutionForm || resolving) return;
    setShowResolveConfirmation(true);
  }

  function toggleInteractionMenu(interactionId) {
    setOpenInteractionMenuId((currentValue) =>
      currentValue === interactionId ? null : interactionId,
    );
  }

  function openStatusFilterMenu() {
    setStatusFilterDraft(statusFilters);
    setStatusFilterMenuOpen(true);
  }

  function closeStatusFilterMenu({ restoreDraft = false } = {}) {
    if (restoreDraft) {
      setStatusFilterDraft(statusFilters);
    }
    setStatusFilterMenuOpen(false);
  }

  function toggleStatusFilterDraft(statusValue) {
    if (statusValue === "all") {
      setStatusFilterDraft([...LEAD_STATUS_FILTER_VALUES]);
      return;
    }
    setStatusFilterDraft((currentValues) => {
      const currentSet = new Set(sortLeadStatusFilters(currentValues));
      if (currentSet.has(statusValue)) {
        currentSet.delete(statusValue);
      } else {
        currentSet.add(statusValue);
      }
      return LEAD_STATUS_FILTER_VALUES.filter((value) => currentSet.has(value));
    });
  }

  function applyStatusFilters() {
    const normalized = sortLeadStatusFilters(statusFilterDraft);
    if (!normalized.length) {
      return;
    }
    setPage(1);
    setStatusFilters(normalized);
    closeStatusFilterMenu();
  }

  useEffect(() => {
    if (!openInteractionMenuId) return undefined;

    function handlePointerDown(event) {
      if (
        interactionMenuRef.current &&
        !interactionMenuRef.current.contains(event.target)
      ) {
        setOpenInteractionMenuId(null);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setOpenInteractionMenuId(null);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openInteractionMenuId]);

  useEffect(() => {
    if (!statusFilterMenuOpen) return undefined;

    function handlePointerDown(event) {
      if (
        statusFilterRef.current &&
        !statusFilterRef.current.contains(event.target)
      ) {
        closeStatusFilterMenu({ restoreDraft: true });
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        closeStatusFilterMenu({ restoreDraft: true });
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [statusFilterMenuOpen, statusFilters]);

  async function loadInteractions(overrides = {}) {
    const effectivePage = Math.max(1, Number(overrides.page ?? page) || 1);
    const effectivePageSize = Math.min(
      50,
      Math.max(1, Number(overrides.pageSize ?? pageSize) || 10),
    );
    const effectiveQuery = String(overrides.query ?? query);
    const rawEffectiveStatuses = overrides.statuses ?? statusFilters;
    const effectiveStatuses = normalizeLeadStatusFilters(
      Array.isArray(rawEffectiveStatuses)
        ? rawEffectiveStatuses
        : [rawEffectiveStatuses],
    );
    const statusesParam =
      effectiveStatuses.length === LEAD_STATUS_FILTER_VALUES.length
        ? "all"
        : effectiveStatuses.join(",");
    const effectiveSource = String(overrides.source ?? sourceFilter);

    setLoading(true);
    try {
      const { data } = await api.get("/api/interactions", {
        params: {
          page: effectivePage,
          pageSize: effectivePageSize,
          query: effectiveQuery,
          statuses: statusesParam,
          source: effectiveSource,
        },
      });
      setItems(Array.isArray(data?.items) ? data.items : []);
      setTotal(Number(data?.total || 0));
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible cargar los leads"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Reloading the list on pagination/filter changes is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadInteractions();
  }, [page, pageSize, query, statusFilters, sourceFilter]);

  useEffect(() => {
    if (!error && !success) return undefined;
    const timer = window.setTimeout(() => {
      setError("");
      setSuccess("");
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [error, success]);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!helpRef.current?.open) {
        return;
      }

      if (!helpRef.current.contains(event.target)) {
        helpRef.current.removeAttribute("open");
      }
    }

    function handleKeyDown(event) {
      if (event.key !== "Escape" || !helpRef.current?.open) {
        return;
      }

      helpRef.current.removeAttribute("open");
      helpRef.current.querySelector("summary")?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  function resetCreateForm() {
    setShowCreateModal(false);
    setCreateFiles([]);
    setCreateLeadSource("");
    setCreatePastedTextName("");
    setCreatePastedText("");
    setCreateUploadSessionPublicId("");
    setCreateUploadingFilesCount(0);
  }

  async function openDetail(itemId) {
    setLoadingDetail(true);
    setError("");
    try {
      const [detailRes, optionsRes] = await Promise.all([
        api.get(`/api/interactions/${itemId}`),
        api.get("/api/interactions/resolution-options"),
      ]);
      setDetail(detailRes.data);
      setOptions(optionsRes.data || options);
      setEditForm(buildEditableForm(detailRes.data));
      setResolutionForm(
        buildInitialResolutionForm(
          detailRes.data,
          optionsRes.data || options,
          currentUser,
        ),
      );
      setResolveDuplicateReview(null);
      setShowDetailModal(true);
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible abrir el lead"));
    } finally {
      setLoadingDetail(false);
    }
  }

  async function handleCreate() {
    const trimmedPastedText = createPastedText.trim();
    if (!createLeadSource) return;
    setCreating(true);
    setError("");
    setCreateInfoMessage("");
    try {
      const formData = new FormData();
      formData.append("leadSource", createLeadSource);
      if (createUploadSessionPublicId) {
        formData.append("uploadSessionPublicId", createUploadSessionPublicId);
      } else {
        const filesToUpload = [...createFiles];
        if (trimmedPastedText) {
          filesToUpload.push(
            buildPastedTextFile({
              fileName: buildPastedTextFileName(createPastedTextName),
              text: trimmedPastedText,
            }),
          );
        }
        filesToUpload.forEach((file) => formData.append("files", file));
      }
      await api.post("/api/interactions", formData, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 120000,
      });
      resetCreateForm();
      setPage(1);
      setQuery("");
      setStatusFilters([...LEAD_STATUS_FILTER_VALUES]);
      setStatusFilterDraft([...LEAD_STATUS_FILTER_VALUES]);
      setSourceFilter("all");
      setSuccess(
        'Lead creado. Abre el lead y pulsa "Analizar documentos para llenar información".',
      );
      await loadInteractions({
        page: 1,
        query: "",
        statuses: LEAD_STATUS_FILTER_VALUES,
        source: "all",
      });
    } catch (err) {
      setCreateInfoMessage(
        getApiErrorMessage(err, "No fue posible crear el lead"),
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteDocument(documentPublicId) {
    if (!detail?.id || !documentPublicId) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm("Este archivo se eliminará del lead. ¿Quieres continuar?")
    ) {
      return;
    }
    setDeletingDocumentPublicId(documentPublicId);
    setError("");
    try {
      const { data } = await api.delete(
        `/api/interactions/${detail.id}/documents/${documentPublicId}`,
      );
      setDetail(data);
      setEditForm(buildEditableForm(data));
      setResolutionForm(buildInitialResolutionForm(data, options, currentUser));
      setSuccess("Archivo eliminado del lead");
      await loadInteractions();
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible eliminar el archivo"));
    } finally {
      setDeletingDocumentPublicId("");
    }
  }

  async function handleAddDocuments(files) {
    if (!detail?.id || !files?.length) return false;
    setAddingDocuments(true);
    setError("");
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      const { data } = await api.post(
        `/api/interactions/${detail.id}/documents`,
        formData,
        {
          headers: { "Content-Type": "multipart/form-data" },
        },
      );
      setDetail(data);
      setEditForm(buildEditableForm(data));
      setResolutionForm(buildInitialResolutionForm(data, options, currentUser));
      setSuccess(
        'Archivos subidos. Usa "Analizar documentos para llenar información" para actualizar sugerencias.',
      );
      await loadInteractions();
      return true;
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible subir archivos al lead"),
      );
      return false;
    } finally {
      setAddingDocuments(false);
    }
  }

  async function handleDeleteInteraction(interaction) {
    if (!interaction?.id) return;
    if (isFinalizedLeadStatus(interaction.analysisStatus)) {
      return;
    }
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Este lead se eliminará de forma permanente. ¿Quieres continuar?",
      )
    ) {
      return;
    }

    setDeletingInteractionId(interaction.id);
    setOpenInteractionMenuId(null);
    setError("");
    try {
      await api.delete(`/api/interactions/${interaction.id}`);
      if (detail && Number(detail.id) === Number(interaction.id)) {
        closeDetailModal();
        setDetail(null);
        setEditForm(null);
        setResolutionForm(null);
      }
      setSuccess("Lead eliminado");
      await loadInteractions();
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible eliminar el lead"));
    } finally {
      setDeletingInteractionId(null);
    }
  }

  async function handleDisqualifyInteraction(interaction) {
    if (!interaction?.id) return;
    if (
      isQualifiedLeadStatus(interaction.analysisStatus) ||
      isDisqualifiedLeadStatus(interaction.analysisStatus)
    ) {
      return;
    }
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Este lead quedará marcado como descalificado. ¿Quieres continuar?",
      )
    ) {
      return;
    }

    setDeletingInteractionId(interaction.id);
    setOpenInteractionMenuId(null);
    setError("");
    try {
      const { data } = await api.post(
        `/api/interactions/${interaction.id}/disqualify`,
      );
      if (detail && Number(detail.id) === Number(interaction.id)) {
        setDetail(data);
        setEditForm(buildEditableForm(data));
        setResolutionForm(
          buildInitialResolutionForm(data, options, currentUser),
        );
      }
      setSuccess("Lead descalificado");
      await loadInteractions();
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible descalificar el lead"));
    } finally {
      setDeletingInteractionId(null);
    }
  }

  async function handleReanalyze() {
    if (!detail) return;
    setReanalyzing(true);
    setError("");
    interactionAnalysisPollingTokenRef.current += 1;
    const pollingToken = interactionAnalysisPollingTokenRef.current;
    try {
      const { data } = await api.post(
        `/api/interactions/${detail.id}/analyze/jobs`,
        {},
        { timeout: INTERACTION_ANALYSIS_TIMEOUT_MS },
      );

      let resolvedData = data;
      if (!resolvedData?.result) {
        const jobId = String(resolvedData?.job?.id || "").trim();
        if (!jobId) {
          throw new Error(
            "No fue posible obtener el identificador del job de análisis",
          );
        }

        const deadline =
          Date.now() + INTERACTION_ANALYSIS_TOTAL_POLL_TIMEOUT_MS;
        let nextDelay = Math.max(
          Number(
            resolvedData?.job?.pollAfterMs ||
              INTERACTION_ANALYSIS_JOB_POLL_INTERVAL_MS,
          ),
          0,
        );

        while (interactionAnalysisPollingTokenRef.current === pollingToken) {
          if (Date.now() >= deadline) {
            resolvedData = {
              error: {
                message:
                  "El análisis sigue tardando mas de 2 minutos. Puedes reintentarlo desde el modal.",
              },
            };
            break;
          }

          if (nextDelay > 0) {
            await new Promise((resolve) => {
              window.setTimeout(resolve, nextDelay);
            });
          }

          if (interactionAnalysisPollingTokenRef.current !== pollingToken) {
            return;
          }

          const pollResponse = await api.get(
            `/api/interactions/${detail.id}/analyze/jobs/${jobId}`,
            { timeout: INTERACTION_ANALYSIS_TIMEOUT_MS },
          );
          resolvedData = pollResponse.data;

          if (resolvedData?.result) {
            break;
          }

          const jobStatus = String(resolvedData?.job?.status || "");
          if (["failed", "stale", "expired"].includes(jobStatus)) {
            break;
          }

          nextDelay = Math.max(
            Number(
              resolvedData?.job?.pollAfterMs ||
                INTERACTION_ANALYSIS_JOB_POLL_INTERVAL_MS,
            ),
            0,
          );
          nextDelay = Math.min(nextDelay, Math.max(deadline - Date.now(), 0));
        }
      }

      if (interactionAnalysisPollingTokenRef.current !== pollingToken) {
        return;
      }

      if (!resolvedData?.result) {
        setError(
          String(resolvedData?.error?.message || "").trim() ||
            "No fue posible reanalizar el lead",
        );
        return;
      }

      const refreshed = await api.get(`/api/interactions/${detail.id}`);
      setDetail(refreshed.data);
      setEditForm(buildEditableForm(refreshed.data));
      setResolutionForm(
        buildInitialResolutionForm(refreshed.data, options, currentUser),
      );
      setSuccess("Lead reanalizado");
      await loadInteractions();
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible reanalizar el lead"));
    } finally {
      if (interactionAnalysisPollingTokenRef.current === pollingToken) {
        setReanalyzing(false);
      }
    }
  }

  async function handleResolve() {
    if (!detail || !editForm || !resolutionForm) return;
    const effectiveResolutionForm = buildEffectiveResolutionForm(
      resolutionForm,
      currentUser,
      detail?.commercialAssignmentPolicy,
      detail,
    );
    setShowResolveConfirmation(false);
    setResolving(true);
    setError("");
    setResolveDuplicateReview(null);
    try {
      const payload = {
        ...editForm,
        sellerUserId: effectiveResolutionForm.sellerUserId
          ? Number(effectiveResolutionForm.sellerUserId)
          : null,
        assignCurrentUserAsOwnerSeller: Boolean(
          effectiveResolutionForm.assignCurrentUserAsOwnerSeller,
        ),
        suggestedAccount: {
          ...(editForm.suggestedAccount || {}),
          ...(effectiveResolutionForm.accountResolution.mode === "create_new"
            ? effectiveResolutionForm.accountResolution.draft
            : {}),
          selectedAccountId:
            effectiveResolutionForm.accountResolution.mode ===
              "link_existing" &&
            effectiveResolutionForm.accountResolution.accountId
              ? Number(effectiveResolutionForm.accountResolution.accountId)
              : null,
        },
        suggestedContacts: editForm.suggestedContacts.map((contact, index) => {
          const resolution = effectiveResolutionForm.contactResolutions[index];
          if (!resolution) return contact;
          return {
            ...contact,
            selectedContactId:
              resolution.mode === "link_existing" && resolution.contactId
                ? Number(resolution.contactId)
                : null,
          };
        }),
        suggestedOpportunities: editForm.suggestedOpportunities.map(
          (opportunity, index) => {
            const resolution =
              effectiveResolutionForm.opportunityResolutions[index];
            if (!resolution) return opportunity;
            return {
              ...opportunity,
              selectedOpportunityId:
                resolution.mode === "link_existing" && resolution.opportunityId
                  ? Number(resolution.opportunityId)
                  : null,
              selectedSellerUserId: effectiveResolutionForm.sellerUserId
                ? Number(effectiveResolutionForm.sellerUserId)
                : null,
            };
          },
        ),
        contactResolutions: effectiveResolutionForm.contactResolutions.map(
          (item) => ({
            ...item,
            contactId: item.contactId ? Number(item.contactId) : null,
            draft:
              item.mode === "create_new"
                ? {
                    ...item.draft,
                    countryId: item.draft.countryId
                      ? Number(item.draft.countryId)
                      : null,
                  }
                : undefined,
          }),
        ),
        opportunityResolutions:
          effectiveResolutionForm.opportunityResolutions.map((item) => ({
            ...item,
            opportunityId: item.opportunityId
              ? Number(item.opportunityId)
              : null,
            draft:
              item.mode === "create_new"
                ? {
                    ...item.draft,
                    contactId: item.draft.contactId
                      ? Number(item.draft.contactId)
                      : null,
                    amountUsd: item.draft.amountUsd
                      ? Number(item.draft.amountUsd)
                      : null,
                    businessLineId: item.draft.businessLineId
                      ? Number(item.draft.businessLineId)
                      : null,
                    sellerUserId: item.draft.sellerUserId
                      ? Number(item.draft.sellerUserId)
                      : null,
                    presalesUserId: item.draft.presalesUserId
                      ? Number(item.draft.presalesUserId)
                      : null,
                  }
                : undefined,
          })),
        accountResolution: {
          ...effectiveResolutionForm.accountResolution,
          accountId: effectiveResolutionForm.accountResolution.accountId
            ? Number(effectiveResolutionForm.accountResolution.accountId)
            : null,
          draft:
            effectiveResolutionForm.accountResolution.mode === "create_new"
              ? {
                  ...effectiveResolutionForm.accountResolution.draft,
                  countryId: effectiveResolutionForm.accountResolution.draft
                    .countryId
                    ? Number(
                        effectiveResolutionForm.accountResolution.draft
                          .countryId,
                      )
                    : null,
                }
              : undefined,
        },
      };
      const { data } = await api.post(
        `/api/interactions/${detail.id}/resolve`,
        payload,
      );
      setDetail(data);
      setEditForm(buildEditableForm(data));
      setResolutionForm(buildInitialResolutionForm(data, options, currentUser));
      closeDetailModal();
      setSuccess("Lead guardado");
      await loadInteractions();
    } catch (err) {
      const duplicatePayload = err?.response?.data;
      if (
        duplicatePayload &&
        (Array.isArray(duplicatePayload.duplicateWarnings) ||
          duplicatePayload.duplicateReview)
      ) {
        setResolveDuplicateReview({
          code: duplicatePayload.code || null,
          message: String(duplicatePayload.message || "").trim(),
          duplicateWarnings: Array.isArray(duplicatePayload.duplicateWarnings)
            ? duplicatePayload.duplicateWarnings
            : [],
          duplicateReview: duplicatePayload.duplicateReview || null,
          duplicateValidationSource:
            duplicatePayload.duplicateValidationSource || "heuristic",
        });
      }
      setError(getApiErrorMessage(err, "No fue posible guardar el lead"));
    } finally {
      setResolving(false);
    }
  }

  const statusFilterLabel = useMemo(
    () => getLeadStatusFilterButtonLabel(statusFilters),
    [statusFilters],
  );
  const allDraftStatusesSelected =
    statusFilterDraft.length === LEAD_STATUS_FILTER_VALUES.length;
  const createIsUploadingFiles = createUploadingFilesCount > 0;

  return (
    <section className="panel">
      <InteractionInfoModal
        message={createInfoMessage}
        onClose={() => setCreateInfoMessage("")}
      />

      <CreateInteractionModal
        isOpen={showCreateModal}
        onClose={resetCreateForm}
        onSubmit={handleCreate}
        creating={creating}
        isUploadingFiles={createUploadingFilesCount > 0}
        setCreateInfoMessage={setCreateInfoMessage}
        leadSource={createLeadSource}
        setLeadSource={setCreateLeadSource}
        files={createFiles}
        setFiles={setCreateFiles}
        onUploadFiles={uploadCreateFilesToSession}
        pastedTextName={createPastedTextName}
        setPastedTextName={setCreatePastedTextName}
        pastedText={createPastedText}
        setPastedText={setCreatePastedText}
      />

      <InteractionDetailModal
        isOpen={showDetailModal}
        onClose={closeDetailModal}
        currentUser={currentUser}
        detail={detail}
        editForm={editForm}
        setEditForm={setEditForm}
        resolutionForm={resolutionForm}
        setResolutionForm={setResolutionForm}
        options={options}
        resolveDuplicateReview={resolveDuplicateReview}
        onDismissResolveDuplicateReview={() => setResolveDuplicateReview(null)}
        saving={saving}
        resolving={resolving}
        reanalyzing={reanalyzing}
        addingDocuments={addingDocuments}
        canUpdate={canUpdate}
        canAddDocuments={Boolean(
          canUpdate && detail && !isFinalizedLeadStatus(detail.analysisStatus),
        )}
        deletingDocumentPublicId={deletingDocumentPublicId}
        canDeleteDocuments={Boolean(
          canUpdate && detail && !isFinalizedLeadStatus(detail.analysisStatus),
        )}
        onAddDocuments={handleAddDocuments}
        onDeleteDocument={handleDeleteDocument}
        onResolve={openResolveConfirmation}
        onReanalyze={handleReanalyze}
        canAnalyze={Boolean(
          canAnalyze &&
          detail &&
          !isDisqualifiedLeadStatus(detail.analysisStatus),
        )}
        canResolve={Boolean(
          canResolve &&
          detail &&
          !isDisqualifiedLeadStatus(detail.analysisStatus),
        )}
      />

      <ResolveInteractionConfirmationModal
        isOpen={showResolveConfirmation}
        onClose={() => setShowResolveConfirmation(false)}
        onConfirm={handleResolve}
        resolving={resolving}
        preview={resolveConfirmationPreview}
      />

      <div className="roles-page-header">
        <div className="roles-page-header-left">
          <div className="module-title-with-icon">
            <h2>Leads</h2>
            <span
              className="module-title-icon module-title-icon-contacts"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5zm2.5-1a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-13a1 1 0 0 0-1-1zm2.25 3h6.5a.75.75 0 1 1 0 1.5h-6.5a.75.75 0 0 1 0-1.5m0 4h6.5a.75.75 0 1 1 0 1.5h-6.5a.75.75 0 0 1 0-1.5m0 4h4.5a.75.75 0 1 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5" />
              </svg>
            </span>
            <details className="accounts-module-help" ref={helpRef}>
              <summary
                className="accounts-module-help-trigger"
                aria-label="Ayuda sobre el módulo de leads"
                title="Ayuda sobre el módulo"
              >
                ?
              </summary>
              <div className="accounts-module-help-popover">
                <strong>Para qué sirve</strong>
                <p>
                  Este módulo centraliza evidencia documental de leads, extrae
                  contexto comercial y te ayuda a relacionarlo con cuenta,
                  contactos, vendedor y oportunidad.
                </p>
                <strong>Cómo usarlo</strong>
                <p>
                  Carga documentos o notas, revisa las sugerencias del sistema y
                  resuelve cada lead vinculando o creando los registros
                  correctos antes de guardarlo.
                </p>
                <strong>Estados del lead</strong>
                <ul className="accounts-module-help-list">
                  <li>
                    <strong>Creado:</strong> falta cuenta o falta al menos un
                    contacto.
                  </li>
                  <li>
                    <strong>Lead no asignado:</strong> ya hay cuenta y al menos
                    un contacto, pero aún no tiene vendedor asignado.
                  </li>
                  <li>
                    <strong>Lead asignado:</strong> ya hay cuenta, contacto y
                    vendedor, pero aún no tiene oportunidad vinculada o creada.
                  </li>
                  <li>
                    <strong>Lead calificado:</strong> ya tiene cuenta, contacto,
                    vendedor y oportunidad.
                  </li>
                  <li>
                    <strong>Lead descalificado:</strong> se determinó que no es
                    una oportunidad comercial viable.
                  </li>
                </ul>
                <strong>Regla rápida</strong>
                <p>
                  La progresion normal es: Creado → Lead no asignado → Lead
                  asignado → Lead calificado. Un lead también puede terminar
                  como descalificado.
                </p>
              </div>
            </details>
          </div>
          <p className="roles-subtitle">
            Centraliza evidencia documental de leads, extrae contexto comercial
            y resuelve cuenta, contactos y oportunidades.
          </p>
        </div>
        {canCreate ? (
          <button
            type="button"
            className="btn-primary"
            onClick={() => setShowCreateModal(true)}
          >
            + Crear lead
          </button>
        ) : null}
      </div>

      <div className="roles-pills-bar accounts-pills-bar-row interaction-leads-toolbar">
        <div className="interaction-leads-status-filter" ref={statusFilterRef}>
          <button
            type="button"
            className="accounts-search-inline interaction-leads-status-trigger"
            aria-haspopup="dialog"
            aria-expanded={statusFilterMenuOpen}
            onClick={() => {
              if (statusFilterMenuOpen) {
                closeStatusFilterMenu({ restoreDraft: true });
                return;
              }
              openStatusFilterMenu();
            }}
          >
            <span>{statusFilterLabel}</span>
            <span aria-hidden="true">▾</span>
          </button>

          {statusFilterMenuOpen ? (
            <div
              className="interaction-leads-status-menu"
              role="dialog"
              aria-label="Filtrar leads por estado"
            >
              <p className="interaction-leads-status-menu-title">
                Filtrar por estado
              </p>

              <label className="interaction-leads-status-option">
                <input
                  type="checkbox"
                  checked={allDraftStatusesSelected}
                  onChange={() => toggleStatusFilterDraft("all")}
                />
                <span>Todas</span>
              </label>

              {LEAD_STATUS_FILTER_OPTIONS.map((option) => (
                <label
                  className="interaction-leads-status-option"
                  key={option.value}
                >
                  <input
                    type="checkbox"
                    checked={statusFilterDraft.includes(option.value)}
                    onChange={() => toggleStatusFilterDraft(option.value)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}

              {!statusFilterDraft.length ? (
                <p className="interaction-leads-status-validation">
                  Selecciona al menos un estado.
                </p>
              ) : null}

              <div className="interaction-leads-status-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setStatusFilterDraft([...LEAD_STATUS_FILTER_VALUES]);
                  }}
                >
                  Seleccionar todas
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={applyStatusFilters}
                  disabled={!statusFilterDraft.length}
                >
                  Aplicar
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="interaction-leads-toolbar-controls">
          <input
            className="accounts-search-inline interaction-search-input interaction-leads-search-input"
            type="text"
            placeholder="Buscar por ID, título, cuenta, oportunidad o resumen"
            value={query}
            onChange={(event) => {
              setPage(1);
              setQuery(event.target.value);
            }}
          />
          <select
            className="accounts-search-inline interaction-leads-source-filter"
            value={sourceFilter}
            onChange={(event) => {
              setPage(1);
              setSourceFilter(event.target.value);
            }}
            aria-label="Filtrar leads por tipo de fuente"
          >
            <option value="all">Todas las fuentes</option>
            {LEAD_SOURCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? <div className="toast toast-error">{error}</div> : null}
      {success ? <div className="toast toast-success">{success}</div> : null}

      {loading ? (
        <div className="centered">Cargando leads...</div>
      ) : !items.length ? (
        <div className="account-opps-empty">Aún no hay leads registrados.</div>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th className="interaction-title-column">Lead</th>
                <th>Cuenta</th>
                <th>Oportunidad</th>
                <th>Vendedor</th>
                <th>Archivos</th>
                <th>Estado</th>
                <th>Creada</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => {
                const statusMeta = getInteractionStatusMeta(
                  item.analysisStatus,
                );
                const displayIndex = (page - 1) * pageSize + index + 1;
                const canDeleteInteraction =
                  canUpdate && !isFinalizedLeadStatus(item.analysisStatus);
                const canDisqualifyInteraction =
                  canUpdate &&
                  !isQualifiedLeadStatus(item.analysisStatus) &&
                  !isDisqualifiedLeadStatus(item.analysisStatus);
                return (
                  <tr key={item.id}>
                    <td title={item.publicId}>{displayIndex}</td>
                    <td className="interaction-title-column">
                      <div className="interaction-table-title-cell">
                        <strong
                          className="interaction-table-title-text"
                          title={normalizeLeadDisplayText(item.title)}
                        >
                          {normalizeLeadDisplayText(item.title)}
                        </strong>
                      </div>
                    </td>
                    <td>{item.accountName || "-"}</td>
                    <td>{item.primaryOpportunityName || "-"}</td>
                    <td>{item.sellerName || item.sellerEmail || "-"}</td>
                    <td>{item.documentCount}</td>
                    <td>
                      <div className="interaction-status-stack">
                        <span className={statusMeta.className}>
                          {statusMeta.label}
                        </span>
                        {item.analysisStatus === "created" ? (
                          <span className="interaction-status-pill is-review">
                            Sin analizar
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td>{formatDate(item.createdAt)}</td>
                    <td className="accounts-actions-cell">
                      <div
                        className="user-kebab-wrap interactions-kebab-wrap"
                        ref={
                          openInteractionMenuId === item.id
                            ? interactionMenuRef
                            : null
                        }
                      >
                        <button
                          type="button"
                          className="kebab-btn"
                          onClick={() => toggleInteractionMenu(item.id)}
                          aria-label="Abrir acciones"
                        >
                          ⋮
                        </button>
                        {openInteractionMenuId === item.id && (
                          <div className="user-kebab-menu">
                            <button
                              type="button"
                              onClick={() => {
                                setOpenInteractionMenuId(null);
                                void openDetail(item.id);
                              }}
                              disabled={
                                loadingDetail ||
                                deletingInteractionId === item.id
                              }
                            >
                              Editar
                            </button>
                            {canDisqualifyInteraction ? (
                              <button
                                type="button"
                                onClick={() => {
                                  void handleDisqualifyInteraction(item);
                                }}
                                disabled={deletingInteractionId === item.id}
                              >
                                {deletingInteractionId === item.id
                                  ? "Guardando..."
                                  : "Marcar descalificado"}
                              </button>
                            ) : null}
                            {canDeleteInteraction ? (
                              <button
                                type="button"
                                className="user-kebab-menu-danger"
                                onClick={() => {
                                  void handleDeleteInteraction(item);
                                }}
                                disabled={deletingInteractionId === item.id}
                              >
                                {deletingInteractionId === item.id
                                  ? "Eliminando..."
                                  : "Eliminar lead"}
                              </button>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="users-pagination">
            <div className="users-pagination-left">
              <span className="users-pagination-info">
                {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, total)}{" "}
                de {total}
              </span>
            </div>
            <div className="users-pagination-center">
              <button
                type="button"
                className="users-page-btn"
                disabled={page === 1}
                onClick={() => setPage((currentPage) => currentPage - 1)}
              >
                ‹
              </button>
              <span className="users-pagination-pages">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                className="users-page-btn"
                disabled={page === totalPages}
                onClick={() => setPage((currentPage) => currentPage + 1)}
              >
                ›
              </button>
            </div>
            <div className="users-pagination-right">
              <span className="users-pagination-label">Por página</span>
              {[10, 20, 30].map((size) => (
                <button
                  key={size}
                  type="button"
                  className={
                    pageSize === size
                      ? "users-perpage-btn is-active"
                      : "users-perpage-btn"
                  }
                  onClick={() => {
                    setPage(1);
                    setPageSize(size);
                  }}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export default InteractionsPage;
