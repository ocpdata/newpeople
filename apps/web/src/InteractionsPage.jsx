import { useEffect, useMemo, useRef, useState } from "react";
import { api, getApiErrorMessage } from "./api";

const INTERACTION_FILE_ACCEPT =
  ".pdf,.docx,.xlsx,.xls,.csv,.txt,.eml,.png,.jpg,.jpeg,.mp3,.wav,.m4a";

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

function formatDateTime(value) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return date.toLocaleString("es-MX");
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

function buildResolveConfirmationPreview(detail, resolutionForm, options) {
  if (!detail || !resolutionForm || !options) return null;

  const accountResolution = resolutionForm.accountResolution || {};
  const accountDraft = accountResolution.draft || {};
  const accountToCreate =
    accountResolution.mode === "create_new"
      ? accountDraft.name || "Nueva cuenta"
      : "";
  const accountToLink =
    accountResolution.mode === "link_existing"
      ? getOptionLabel(options.accounts || [], accountResolution.accountId)
      : "";

  const contactsToCreate = (resolutionForm.contactResolutions || [])
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.mode === "create_new")
    .map(({ item, index }) => ({
      title: formatContactName(item.draft, `Contacto ${index + 1}`),
      meta: [item.draft?.email, item.draft?.positionTitle]
        .filter(Boolean)
        .join(" · "),
    }));

  const contactsToLink = (resolutionForm.contactResolutions || [])
    .filter((item) => item.mode === "link_existing")
    .map((item) =>
      getOptionLabel(options.contacts || [], item.contactId, [
        "full_name",
        "name",
      ]),
    )
    .filter(Boolean);

  const opportunitiesToCreate = (resolutionForm.opportunityResolutions || [])
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
        item.draft?.sellerUserId
          ? `Vendedor: ${getOptionLabel(options.sellerUsers || [], item.draft.sellerUserId, ["full_name", "name"])}`
          : "",
        item.draft?.presalesUserId
          ? `Preventa: ${getOptionLabel(options.presalesUsers || [], item.draft.presalesUserId, ["full_name", "name"])}`
          : "",
        item.isPrimary ? "Principal" : "",
      ]
        .filter(Boolean)
        .join(" · "),
    }));

  const opportunitiesToLink = (resolutionForm.opportunityResolutions || [])
    .filter((item) => item.mode === "link_existing")
    .map((item) =>
      getOptionLabel(options.opportunities || [], item.opportunityId),
    )
    .filter(Boolean);

  return {
    interactionTitle: detail.title || "Interacción sin título",
    accountToCreate,
    accountToLink,
    contactsToCreate,
    contactsToLink,
    opportunitiesToCreate,
    opportunitiesToLink,
    ignoredContactsCount: (resolutionForm.contactResolutions || []).filter(
      (item) => item.mode === "ignore",
    ).length,
    ignoredOpportunitiesCount: (
      resolutionForm.opportunityResolutions || []
    ).filter((item) => item.mode === "ignore").length,
  };
}

function getInteractionStatusMeta(status) {
  switch (status) {
    case "resolved":
      return {
        label: "Resuelta",
        className: "interaction-status-pill is-resolved",
        toneClassName: "interaction-summary-card is-resolved",
      };
    case "analyzed":
      return {
        label: "Analizada",
        className: "interaction-status-pill is-analyzed",
        toneClassName: "interaction-summary-card is-analyzed",
      };
    case "requires_review":
      return {
        label: "Requiere revisión",
        className: "interaction-status-pill is-review",
        toneClassName: "interaction-summary-card is-review",
      };
    case "uploaded":
      return {
        label: "Cargada",
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

function getInteractionFilterPillClass(filter, selectedFilter) {
  const isSelected = filter === selectedFilter;
  if (filter === "analyzed") {
    return isSelected
      ? "status-filter-pill status-filter-pill-active is-selected"
      : "status-filter-pill status-filter-pill-active";
  }
  if (filter === "resolved") {
    return isSelected
      ? "status-filter-pill interaction-filter-pill-resolved is-selected"
      : "status-filter-pill interaction-filter-pill-resolved";
  }
  if (filter === "requires_review") {
    return isSelected
      ? "status-filter-pill status-filter-pill-pending is-selected"
      : "status-filter-pill status-filter-pill-pending";
  }
  if (filter === "uploaded") {
    return isSelected
      ? "status-filter-pill interaction-filter-pill-uploaded is-selected"
      : "status-filter-pill interaction-filter-pill-uploaded";
  }
  return isSelected
    ? "status-filter-pill status-filter-pill-all is-selected"
    : "status-filter-pill status-filter-pill-all";
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

  return `Extraccion: ${extractionLabel} | Transcripcion: ${transcriptionLabel}`;
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
      : currentUser?.id
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
  const suggestedAccount = detail?.suggestedAccount || null;
  const accountResolution = suggestedAccount?.selectedAccountId
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
            description: suggestedAccount.description || detail?.summary || "",
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
    (contact) => ({
      suggestionId: contact.suggestionId,
      mode: contact.selectedContactId
        ? "link_existing"
        : contact.fullName
          ? "create_new"
          : "ignore",
      contactId: contact.selectedContactId
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
    }),
  );

  const opportunityResolutions = (detail?.suggestedOpportunities || []).map(
    (opportunity, index) => ({
      suggestionId: opportunity.suggestionId,
      mode: opportunity.selectedOpportunityId
        ? "link_existing"
        : opportunity.name
          ? "create_new"
          : "ignore",
      opportunityId: opportunity.selectedOpportunityId
        ? String(opportunity.selectedOpportunityId)
        : "",
      isPrimary: index === 0,
      draft: buildDefaultOpportunityDraft(opportunity, options, currentUser),
    }),
  );

  return { accountResolution, contactResolutions, opportunityResolutions };
}

function buildEditableForm(detail) {
  return {
    title: detail?.title || "",
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
  files,
  setFiles,
  pastedTextName,
  setPastedTextName,
  pastedText,
  setPastedText,
}) {
  const createHelpRef = useRef(null);
  const [showCreateHelp, setShowCreateHelp] = useState(false);

  useEffect(() => {
    if (!showCreateHelp) return undefined;

    function handlePointerDown(event) {
      if (!createHelpRef.current?.contains(event.target)) {
        setShowCreateHelp(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setShowCreateHelp(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showCreateHelp]);

  if (!isOpen) return null;

  const handleFileChange = (event) => {
    const nextFiles = Array.from(event.target.files || []);
    setFiles(nextFiles);
  };

  const handleAddPastedText = () => {
    const trimmedText = String(pastedText || "").trim();
    if (!trimmedText) return;

    setFiles((currentFiles) => [
      ...currentFiles,
      buildPastedTextFile({
        fileName: buildPastedTextFileName(pastedTextName),
        text: trimmedText,
      }),
    ]);
    setPastedTextName("");
    setPastedText("");
  };

  return (
    <div
      className="modal-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget && !creating) onClose();
      }}
    >
      <div
        className={`modal-dialog modal-dialog-wide interaction-modal modal-dialog-with-scroll-shell${creating ? " modal-dialog-busy" : ""}`}
        aria-busy={creating}
      >
        <div className="modal-dialog-scroll-shell">
        <div className="modal-header">
          <div className="interaction-create-header">
            <div className="interaction-create-heading">
              <span className="interaction-create-kicker">
                Nueva interacción
              </span>
              <div className="account-modal-help-shell" ref={createHelpRef}>
                <div className="account-modal-title-row">
                  <h3 className="modal-title">Crear interacción</h3>
                  <button
                    type="button"
                    className="accounts-module-help-trigger account-modal-help-trigger"
                    aria-label="Ayuda sobre el modal de crear interacción"
                    aria-expanded={showCreateHelp}
                    title="Ayuda sobre el modal de crear interacción"
                    onClick={() => setShowCreateHelp((current) => !current)}
                  >
                    ?
                  </button>
                </div>
                {showCreateHelp ? (
                  <div
                    className="account-modal-help-popover"
                    role="dialog"
                    aria-label="Ayuda sobre crear interacción"
                  >
                    <strong>Para qué sirve este modal</strong>
                    <p>
                      Úsalo para reunir evidencia comercial inicial y crear una
                      interacción analizable a partir de archivos o texto.
                    </p>
                    <strong>Cómo conviene usarlo</strong>
                    <p>
                      Sube documentos, agrega texto adicional si hace falta y
                      luego crea la interacción para que el sistema sugiera
                      cuenta, contactos y oportunidades relacionadas.
                    </p>
                  </div>
                ) : null}
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
        <fieldset className="interaction-detail-lock-shell" disabled={creating}>
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
                    onChange={handleFileChange}
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
                    de soporte. Si prefieres, también puedes crear la
                    interacción solo con texto pegado.
                  </span>
                  <span className="interaction-create-dropzone-action">
                    Elegir archivos
                  </span>
                  <span className="interaction-create-dropzone-footnote">
                    Formatos soportados: PDF, DOCX, XLSX, XLS, CSV, TXT, EML,
                    PNG, JPG, JPEG, MP3, WAV y M4A.
                  </span>
                </label>

                <div className="interaction-create-guidance">
                  <div className="interaction-create-guidance-card">
                    <strong>1. Carga evidencia</strong>
                    <p>
                      Reúne los archivos que explican el contexto comercial del
                      caso.
                    </p>
                  </div>
                  <div className="interaction-create-guidance-card">
                    <strong>2. Análisis inicial</strong>
                    <p>
                      El sistema extrae contenido y detecta cuenta, contactos y
                      oportunidades sugeridas.
                    </p>
                  </div>
                  <div className="interaction-create-guidance-card">
                    <strong>3. Resolución</strong>
                    <p>
                      Luego podrás revisar sugerencias y confirmar los vínculos
                      correctos en el CRM.
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <section className="account-form-section account-modal-section interaction-create-text-section">
              <div className="interaction-create-text-card">
                <div className="interaction-create-text-card-head">
                  <div className="interaction-create-text-card-copy">
                    <span className="interaction-create-kicker">
                      Texto de referencia
                    </span>
                    <strong>Agrega mas fuentes de texto al analisis</strong>
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
                      onChange={(event) => setPastedTextName(event.target.value)}
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
                      Agregar texto al analisis
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
                      placeholder="Pega aquí el contenido que quieres añadir al análisis de la interacción."
                    />
                  </div>
                </div>

                <span className="field-hint interaction-create-text-footnote">
                  Se agregará como un archivo `.txt` al análisis.
                </span>
              </div>
            </section>

            <section className="account-form-section account-modal-section interaction-create-files-section">
              <div className="interaction-create-files-header">
                <h4>Archivos seleccionados</h4>
                <p className="section-helper-text">
                  Revisa aquí la evidencia que se usará para crear la
                  interacción.
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
                type="button"
                className="btn-secondary"
                onClick={onClose}
                disabled={creating}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={creating || (!files.length && !pastedText.trim())}
              >
                {creating ? "Analizando..." : "Crear interacción"}
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
              <strong>Creando interacción</strong>
              <span>
                Estamos cargando los archivos y esperando a que termine el
                análisis inicial.
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function InteractionDetailModal({
  isOpen,
  onClose,
  detail,
  editForm,
  setEditForm,
  resolutionForm,
  setResolutionForm,
  options,
  saving,
  resolving,
  reanalyzing,
  canUpdate,
  canAnalyze,
  canResolve,
  addingDocuments,
  canAddDocuments,
  deletingDocumentPublicId,
  canDeleteDocuments,
  onAddDocuments,
  onDeleteDocument,
  onSave,
  onResolve,
  onReanalyze,
}) {
  const [additionalFiles, setAdditionalFiles] = useState([]);
  const [uploadInputKey, setUploadInputKey] = useState(0);

  useEffect(() => {
    setAdditionalFiles([]);
    setUploadInputKey((currentValue) => currentValue + 1);
  }, [detail?.id, isOpen]);

  if (!isOpen || !detail || !editForm || !resolutionForm) return null;

  const isAnalysisLocked = reanalyzing || addingDocuments;
  const analysisProgressTitle = reanalyzing
    ? "Reanalizando interacción"
    : "Analizando archivos anexados";
  const analysisProgressMessage = reanalyzing
    ? "Estamos actualizando la sinopsis, sugerencias y relaciones detectadas."
    : "Estamos procesando los archivos nuevos y actualizando el análisis de la interacción.";

  const statusMeta = getInteractionStatusMeta(detail.analysisStatus);
  const resolvedAccountId =
    resolutionForm.accountResolution.mode === "link_existing"
      ? Number(resolutionForm.accountResolution.accountId || 0) || null
      : null;
  const availableContacts = resolvedAccountId
    ? options.contacts.filter(
        (contact) => Number(contact.account_id) === resolvedAccountId,
      )
    : options.contacts;
  const availableOpportunities = resolvedAccountId
    ? options.opportunities.filter(
        (opportunity) => Number(opportunity.account_id) === resolvedAccountId,
      )
    : options.opportunities;
  const showDependentResolutionSections =
    resolutionForm.accountResolution.mode !== "ignore";
  const hasResolvedSuggestedContact = resolutionForm.contactResolutions.some(
    (resolution) => resolution.mode !== "ignore",
  );

  const handleAdditionalFileChange = (event) => {
    setAdditionalFiles(Array.from(event.target.files || []));
  };

  const handleAddDocumentsClick = async () => {
    if (!additionalFiles.length || !onAddDocuments) return;
    const added = await onAddDocuments(additionalFiles);
    if (added) {
      setAdditionalFiles([]);
      setUploadInputKey((currentValue) => currentValue + 1);
    }
  };

  const interactionDocumentCount = Array.isArray(detail?.documents)
    ? detail.documents.length
    : 0;
  const pendingAdditionalFilesCount = additionalFiles.length;
  const addDocumentsButtonLabel = addingDocuments
    ? "Anexando archivos..."
    : pendingAdditionalFilesCount
      ? `Anexar ${pendingAdditionalFilesCount} archivo${
          pendingAdditionalFilesCount === 1 ? "" : "s"
        }`
      : "Anexar archivos";

  return (
    <div
      className="modal-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget && !isAnalysisLocked)
          onClose();
      }}
    >
      <div
        className={`modal-dialog modal-dialog-wide interaction-modal interaction-detail-modal modal-dialog-with-scroll-shell${isAnalysisLocked ? " modal-dialog-busy" : ""}`}
        aria-busy={isAnalysisLocked}
      >
        <div className="modal-dialog-scroll-shell">
        <div className="modal-header">
          <div className="interaction-detail-header-copy">
            <h3 className="modal-title">{detail.title}</h3>
            <p className="roles-subtitle">
              Creada {formatDate(detail.createdAt)}
            </p>
          </div>
          <div className="interaction-detail-header-actions">
            <span className={statusMeta.className}>{statusMeta.label}</span>
            {canAnalyze ? (
              <button
                type="button"
                className="interaction-detail-icon-btn"
                onClick={onReanalyze}
                disabled={isAnalysisLocked}
                aria-label={
                  reanalyzing
                    ? "Reanalizando interacción"
                    : "Reanalizar interacción"
                }
                title={
                  reanalyzing ? "Reanalizando..." : "Reanalizar interacción"
                }
              >
                <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                  <path d="M20 11a8 8 0 0 0-14.9-4" />
                  <path d="M4 4v4h4" />
                  <path d="M4 13a8 8 0 0 0 14.9 4" />
                  <path d="M20 20v-4h-4" />
                </svg>
              </button>
            ) : null}
          </div>
        </div>
        <fieldset
          className="interaction-detail-lock-shell"
          disabled={isAnalysisLocked}
        >
          <div className="interaction-detail-scroll">
            <section className="account-form-section account-modal-section">
              {canAddDocuments ? (
                <div className="interaction-documents-toolbar">
                  <div className="field-group interaction-documents-upload-field">
                    <div className="interaction-documents-toolbar-head">
                      <div>
                        <label>Agregar más archivos</label>
                        <p className="field-hint interaction-documents-step-hint">
                          1. Selecciona los archivos. 2. Haz clic en anexar.
                        </p>
                      </div>
                      <span className="interaction-documents-count-badge">
                        {interactionDocumentCount} archivo
                        {interactionDocumentCount === 1 ? "" : "s"} en la
                        interaccion
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
                        Se reanalizara automaticamente al agregar archivos.
                      </p>
                      {pendingAdditionalFilesCount ? (
                        <span className="interaction-documents-pending-note">
                          {pendingAdditionalFilesCount} archivo
                          {pendingAdditionalFilesCount === 1 ? "" : "s"} listo
                          {pendingAdditionalFilesCount === 1 ? "" : "s"} para
                          anexar
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className="btn-secondary interaction-documents-submit-button"
                        onClick={handleAddDocumentsClick}
                        disabled={addingDocuments || !additionalFiles.length}
                      >
                        {addDocumentsButtonLabel}
                      </button>
                    </div>
                    {additionalFiles.length ? (
                      <div className="interaction-upload-list">
                        {additionalFiles.map((file) => (
                          <span
                            key={`${file.name}-${file.size}`}
                            className="account-interaction-contact-chip"
                          >
                            {file.name}
                          </span>
                        ))}
                      </div>
                    ) : null}
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
                    Define si la interacción se vincula a una cuenta existente o
                    crea una nueva.
                  </p>
                </div>
              </div>
              <div className="interaction-resolution-grid interaction-account-suggestion-grid">
                <div className="field-group interaction-resolution-action-field">
                  <label>Acción</label>
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
                    <option value="ignore">Ignorar</option>
                    <option value="link_existing">Vincular existente</option>
                    <option value="create_new">Crear cuenta</option>
                  </select>
                </div>
                {resolutionForm.accountResolution.mode === "link_existing" ? (
                  <div className="field-group interaction-grid-span-2 interaction-account-existing-field">
                    <label>Cuenta existente</label>
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
                      {options.accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name}
                        </option>
                      ))}
                    </select>
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
                <section className="account-form-section account-modal-section interaction-detail-section interaction-contact-suggestion-section">
                  <h4>Contactos sugeridos</h4>
                  {(editForm.suggestedContacts || []).map((contact, index) => {
                    const resolution = resolutionForm.contactResolutions[index];
                    if (!resolution) return null;
                    return (
                      <article
                        key={contact.suggestionId}
                        className="interaction-resolution-card"
                      >
                        <div className="interaction-resolution-card-head">
                          <strong>
                            {contact.fullName ||
                              `${contact.firstName} ${contact.lastName}`}
                          </strong>
                          <span className="field-hint">
                            {contact.reason || "Sugerido por análisis"}
                          </span>
                        </div>
                        <div className="interaction-resolution-grid interaction-contact-suggestion-grid">
                          <div className="field-group interaction-resolution-action-field">
                            <label>Acción</label>
                            <select
                              value={resolution.mode}
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
                              <option value="ignore">Ignorar</option>
                              <option value="link_existing">
                                Vincular existente
                              </option>
                              <option value="create_new">Crear contacto</option>
                            </select>
                          </div>
                          {resolution.mode === "link_existing" ? (
                            <div className="field-group interaction-grid-span-2 interaction-contact-existing-field">
                              <label>Contacto existente</label>
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
                                                contactId: event.target.value,
                                              }
                                            : item,
                                      ),
                                  }))
                                }
                              >
                                <option value="">Selecciona contacto</option>
                                {availableContacts.map((option) => (
                                  <option key={option.id} value={option.id}>
                                    {option.full_name}
                                  </option>
                                ))}
                              </select>
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

                {hasResolvedSuggestedContact ? (
                  <section className="account-form-section account-modal-section interaction-detail-section interaction-opportunity-suggestion-section">
                    <h4>Oportunidades sugeridas</h4>
                    {(editForm.suggestedOpportunities || []).map(
                      (opportunity, index) => {
                        const resolution =
                          resolutionForm.opportunityResolutions[index];
                        if (!resolution) return null;
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
                              <label className="interaction-primary-checkbox">
                                <input
                                  type="checkbox"
                                  checked={resolution.isPrimary}
                                  onChange={() =>
                                    setResolutionForm((prev) => ({
                                      ...prev,
                                      opportunityResolutions:
                                        prev.opportunityResolutions.map(
                                          (item, itemIndex) => ({
                                            ...item,
                                            isPrimary: itemIndex === index,
                                          }),
                                        ),
                                    }))
                                  }
                                />
                                Principal
                              </label>
                            </div>
                            <div className="interaction-resolution-grid interaction-opportunity-suggestion-grid">
                              <div className="field-group interaction-resolution-action-field">
                                <label>Acción</label>
                                <select
                                  value={resolution.mode}
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
                                >
                                  <option value="ignore">Ignorar</option>
                                  <option value="link_existing">
                                    Vincular existente
                                  </option>
                                  <option value="create_new">
                                    Crear oportunidad
                                  </option>
                                </select>
                              </div>
                              {resolution.mode === "link_existing" ? (
                                <div className="field-group interaction-grid-span-3 interaction-opportunity-existing-field">
                                  <label>Oportunidad existente</label>
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
                                      <option key={option.id} value={option.id}>
                                        {option.name}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              ) : null}
                              {resolution.mode === "create_new" ? (
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
                                    <select
                                      value={resolution.draft.sellerUserId}
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
                                                        sellerUserId:
                                                          event.target.value,
                                                      },
                                                    }
                                                  : item,
                                            ),
                                        }))
                                      }
                                    >
                                      <option value="">Sin vendedor</option>
                                      {options.sellerUsers.map((user) => (
                                        <option key={user.id} value={user.id}>
                                          {user.full_name}
                                        </option>
                                      ))}
                                    </select>
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
                      },
                    )}
                  </section>
                ) : null}
              </>
            ) : null}
          </div>

          <div className="modal-buttons interaction-detail-modal-buttons">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={isAnalysisLocked}
            >
              Cerrar
            </button>
            {canUpdate &&
            detail &&
            (detail.resolvedAt || detail.analysisStatus === "resolved") ? (
              <button
                type="button"
                className="btn-primary"
                onClick={onSave}
                disabled={saving}
              >
                {saving ? "Guardando..." : "Guardar cambios"}
              </button>
            ) : null}
            {canResolve ? (
              <button
                type="button"
                className="btn-primary"
                onClick={onResolve}
                disabled={resolving}
              >
                {resolving ? "Resolviendo..." : "Resolver interacción"}
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
            <h3 className="modal-title">Confirmar resolución</h3>
            <p className="roles-subtitle resolve-confirmation-subtitle">
              Revisa lo que se aplicará a la interacción{" "}
              {preview.interactionTitle}.
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
            {resolving ? "Resolviendo..." : "Confirmar y resolver"}
          </button>
        </div>
      </div>
    </div>
  );
}

function InteractionsPage({ can, currentUser }) {
  const helpRef = useRef(null);
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createFiles, setCreateFiles] = useState([]);
  const [createPastedTextName, setCreatePastedTextName] = useState("");
  const [createPastedText, setCreatePastedText] = useState("");
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
    presalesUsers: [],
  });
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [addingDocuments, setAddingDocuments] = useState(false);
  const [deletingDocumentPublicId, setDeletingDocumentPublicId] = useState("");
  const [deletingInteractionId, setDeletingInteractionId] = useState(null);
  const [openInteractionMenuId, setOpenInteractionMenuId] = useState(null);
  const [showResolveConfirmation, setShowResolveConfirmation] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const canCreate = can("interacciones.create");
  const canUpdate = can("interacciones.update");
  const canAnalyze = can("interacciones.analyze");
  const canResolve = can("interacciones.resolve");
  const resolveConfirmationPreview = useMemo(
    () => buildResolveConfirmationPreview(detail, resolutionForm, options),
    [detail, resolutionForm, options],
  );

  function closeDetailModal() {
    setShowResolveConfirmation(false);
    setShowDetailModal(false);
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

  async function loadInteractions() {
    setLoading(true);
    try {
      const { data } = await api.get("/api/interactions", {
        params: { page, pageSize, query, status: statusFilter },
      });
      setItems(Array.isArray(data?.items) ? data.items : []);
      setTotal(Number(data?.total || 0));
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible cargar las interacciones"),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadInteractions();
  }, [page, pageSize, query, statusFilter]);

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
    setCreatePastedTextName("");
    setCreatePastedText("");
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
      setShowDetailModal(true);
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible abrir la interacción"));
    } finally {
      setLoadingDetail(false);
    }
  }

  async function handleCreate() {
    const trimmedPastedText = createPastedText.trim();
    if (!createFiles.length && !trimmedPastedText) return;
    setCreating(true);
    setError("");
    try {
      const formData = new FormData();
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
      const { data } = await api.post("/api/interactions", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      resetCreateForm();
      setSuccess("Interacción creada y analizada");
      await loadInteractions();
      await openDetail(data.id);
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible crear la interacción"));
    } finally {
      setCreating(false);
    }
  }

  async function handleSave() {
    if (!detail || !editForm) return;
    setSaving(true);
    setError("");
    try {
      const { data } = await api.put(
        `/api/interactions/${detail.id}`,
        editForm,
      );
      setDetail(data);
      setEditForm(buildEditableForm(data));
      setSuccess("Interacción actualizada");
      await loadInteractions();
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible guardar la interacción"),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteDocument(documentPublicId) {
    if (!detail?.id || !documentPublicId) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Este archivo se eliminará de la interacción. ¿Quieres continuar?",
      )
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
      setSuccess("Archivo eliminado de la interacción");
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
      setSuccess("Archivos agregados y análisis actualizado");
      await loadInteractions();
      return true;
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible agregar archivos a la interacción",
        ),
      );
      return false;
    } finally {
      setAddingDocuments(false);
    }
  }

  async function handleDeleteInteraction(interaction) {
    if (!interaction?.id) return;
    if (interaction.resolvedAt || interaction.analysisStatus === "resolved") {
      return;
    }
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Esta interacción se eliminará de forma permanente. ¿Quieres continuar?",
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
      setSuccess("Interacción eliminada");
      await loadInteractions();
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible eliminar la interacción"),
      );
    } finally {
      setDeletingInteractionId(null);
    }
  }

  async function handleReanalyze() {
    if (!detail) return;
    setReanalyzing(true);
    setError("");
    try {
      const { data } = await api.post(`/api/interactions/${detail.id}/analyze`);
      setDetail(data);
      setEditForm(buildEditableForm(data));
      setResolutionForm(buildInitialResolutionForm(data, options, currentUser));
      setSuccess("Interacción reanalizada");
      await loadInteractions();
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible reanalizar la interacción"),
      );
    } finally {
      setReanalyzing(false);
    }
  }

  async function handleResolve() {
    if (!detail || !editForm || !resolutionForm) return;
    setShowResolveConfirmation(false);
    setResolving(true);
    setError("");
    try {
      const payload = {
        ...editForm,
        contactResolutions: resolutionForm.contactResolutions.map((item) => ({
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
        })),
        opportunityResolutions: resolutionForm.opportunityResolutions.map(
          (item) => ({
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
          }),
        ),
        accountResolution: {
          ...resolutionForm.accountResolution,
          accountId: resolutionForm.accountResolution.accountId
            ? Number(resolutionForm.accountResolution.accountId)
            : null,
          draft:
            resolutionForm.accountResolution.mode === "create_new"
              ? {
                  ...resolutionForm.accountResolution.draft,
                  countryId: resolutionForm.accountResolution.draft.countryId
                    ? Number(resolutionForm.accountResolution.draft.countryId)
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
      setSuccess("Interacción resuelta");
      await loadInteractions();
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible resolver la interacción"),
      );
    } finally {
      setResolving(false);
    }
  }

  const statusCounts = useMemo(() => {
    return items.reduce(
      (accumulator, item) => ({
        ...accumulator,
        [item.analysisStatus]:
          Number(accumulator[item.analysisStatus] || 0) + 1,
      }),
      {},
    );
  }, [items]);

  return (
    <section className="panel">
      <CreateInteractionModal
        isOpen={showCreateModal}
        onClose={resetCreateForm}
        onSubmit={handleCreate}
        creating={creating}
        files={createFiles}
        setFiles={setCreateFiles}
        pastedTextName={createPastedTextName}
        setPastedTextName={setCreatePastedTextName}
        pastedText={createPastedText}
        setPastedText={setCreatePastedText}
      />

      <InteractionDetailModal
        isOpen={showDetailModal}
        onClose={closeDetailModal}
        detail={detail}
        editForm={editForm}
        setEditForm={setEditForm}
        resolutionForm={resolutionForm}
        setResolutionForm={setResolutionForm}
        options={options}
        saving={saving}
        resolving={resolving}
        reanalyzing={reanalyzing}
        addingDocuments={addingDocuments}
        canUpdate={canUpdate}
        canAnalyze={canAnalyze}
        canResolve={canResolve}
        canAddDocuments={Boolean(
          canUpdate &&
          detail &&
          !detail.resolvedAt &&
          detail.analysisStatus !== "resolved",
        )}
        deletingDocumentPublicId={deletingDocumentPublicId}
        canDeleteDocuments={Boolean(canUpdate && detail && !detail.resolvedAt)}
        onAddDocuments={handleAddDocuments}
        onDeleteDocument={handleDeleteDocument}
        onSave={handleSave}
        onResolve={openResolveConfirmation}
        onReanalyze={handleReanalyze}
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
            <h2>Interacciones</h2>
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
                aria-label="Ayuda sobre el módulo de interacciones"
                title="Ayuda sobre el módulo"
              >
                ?
              </summary>
              <div className="accounts-module-help-popover">
                <strong>Para qué sirve</strong>
                <p>
                  Este módulo centraliza documentos, notas e interacciones
                  comerciales para extraer contexto y relacionarlo con cuentas,
                  contactos y oportunidades.
                </p>
                <strong>Cómo usarlo</strong>
                <p>
                  Úsalo para cargar evidencia, analizarla, revisar sugerencias
                  del sistema y resolver cada caso enlazando o creando los
                  registros comerciales correctos.
                </p>
              </div>
            </details>
          </div>
          <p className="roles-subtitle">
            Centraliza evidencia documental, extrae contexto comercial y
            resuelve cuenta, contactos y oportunidades.
          </p>
        </div>
        {canCreate ? (
          <button
            type="button"
            className="btn-primary"
            onClick={() => setShowCreateModal(true)}
          >
            + Crear interacción
          </button>
        ) : null}
      </div>

      <div className="roles-pills-bar accounts-pills-bar-row">
        <div
          className="accounts-status-pills"
          role="group"
          aria-label="Filtrar interacciones por estado"
        >
          <button
            type="button"
            className={getInteractionFilterPillClass("analyzed", statusFilter)}
            aria-pressed={statusFilter === "analyzed"}
            onClick={() => {
              setPage(1);
              setStatusFilter("analyzed");
            }}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Analizadas</span>
            <span className="status-filter-pill-count">
              {statusCounts.analyzed || 0}
            </span>
          </button>
          <button
            type="button"
            className={getInteractionFilterPillClass(
              "requires_review",
              statusFilter,
            )}
            aria-pressed={statusFilter === "requires_review"}
            onClick={() => {
              setPage(1);
              setStatusFilter("requires_review");
            }}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Revisión</span>
            <span className="status-filter-pill-count">
              {statusCounts.requires_review || 0}
            </span>
          </button>
          <button
            type="button"
            className={getInteractionFilterPillClass("uploaded", statusFilter)}
            aria-pressed={statusFilter === "uploaded"}
            onClick={() => {
              setPage(1);
              setStatusFilter("uploaded");
            }}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Subidas</span>
            <span className="status-filter-pill-count">
              {statusCounts.uploaded || 0}
            </span>
          </button>
          <button
            type="button"
            className={getInteractionFilterPillClass("resolved", statusFilter)}
            aria-pressed={statusFilter === "resolved"}
            onClick={() => {
              setPage(1);
              setStatusFilter("resolved");
            }}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Resueltas</span>
            <span className="status-filter-pill-count">
              {statusCounts.resolved || 0}
            </span>
          </button>
          <button
            type="button"
            className={getInteractionFilterPillClass("all", statusFilter)}
            aria-pressed={statusFilter === "all"}
            onClick={() => {
              setPage(1);
              setStatusFilter("all");
            }}
          >
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Todas</span>
            <span className="status-filter-pill-count">{total}</span>
          </button>
        </div>
        <input
          className="accounts-search-inline interaction-search-input"
          type="text"
          placeholder="Buscar por ID, título, cuenta, oportunidad o resumen"
          value={query}
          onChange={(event) => {
            setPage(1);
            setQuery(event.target.value);
          }}
        />
      </div>

      {error ? <div className="toast toast-error">{error}</div> : null}
      {success ? <div className="toast toast-success">{success}</div> : null}

      {loading ? (
        <div className="centered">Cargando interacciones...</div>
      ) : !items.length ? (
        <div className="account-opps-empty">
          Aún no hay interacciones registradas.
        </div>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th className="interaction-title-column">Título</th>
                <th>Cuenta</th>
                <th>Oportunidad</th>
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
                  canUpdate &&
                  !item.resolvedAt &&
                  item.analysisStatus !== "resolved";
                return (
                  <tr key={item.id}>
                    <td title={item.publicId}>{displayIndex}</td>
                    <td className="interaction-title-column">
                      <div className="interaction-table-title-cell">
                        <strong
                          className="interaction-table-title-text"
                          title={item.title}
                        >
                          {item.title}
                        </strong>
                      </div>
                    </td>
                    <td>{item.accountName || "-"}</td>
                    <td>{item.primaryOpportunityName || "-"}</td>
                    <td>{item.documentCount}</td>
                    <td>
                      <span className={statusMeta.className}>
                        {statusMeta.label}
                      </span>
                    </td>
                    <td>{formatDate(item.createdAt)}</td>
                    <td className="accounts-actions-cell">
                      <div className="user-kebab-wrap interactions-kebab-wrap">
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
                              Abrir interacción
                            </button>
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
                                  : "Eliminar interacción"}
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
