import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, getApiErrorMessage } from "./api";
import ProposalRichTextEditor from "./ProposalRichTextEditor";
import { legacyBlocksToTiptap } from "./proposalRichText";
import "./proposal-document-module.css";
import "../../../shared/proposal-document-print.css";
import { getProposalFormat } from "../../../shared/proposal-formats.js";

const BLOCK_TYPE_LABELS = {
  heading: "Encabezado",
  paragraph: "Párrafo",
  list: "Lista",
  image: "Imagen",
};

function makeId(prefix) {
  const random =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

function buildEmptySection() {
  return {
    id: makeId("section"),
    source_code: null,
    title: "Nueva sección",
    blocks: [],
  };
}

function buildBlock(type) {
  const base = { id: makeId("block"), type, ai_generated: false };
  if (type === "heading") return { ...base, text: "" };
  if (type === "list") return { ...base, items: [""] };
  return { ...base, text: "" };
}

function normalizeContent(content) {
  const safe = content && typeof content === "object" ? content : {};
  const sections = Array.isArray(safe.sections) ? safe.sections : [];
  const sourceDocument = safe.document && typeof safe.document === "object"
    ? safe.document
    : undefined;
  const document = sourceDocument?.type === "doc" && !sourceDocument.content?.some(
    (node) => node.type === "proposalSection",
  )
    ? {
        ...sourceDocument,
        content: (sourceDocument.content || []).reduce((result, node) => {
          if (node.type === "heading" && Number(node.attrs?.level) === 2) {
            result.push({ type: "proposalSection", content: [node] });
          } else if (result.length && result[result.length - 1].type === "proposalSection") {
            result[result.length - 1].content.push(node);
          } else {
            result.push(node);
          }
          return result;
        }, []),
      }
    : sourceDocument;
  const usedSectionIds = new Set();
  const normalizedSections = sections.map((section, sectionIndex) => {
    const requestedId = String(section?.id || "").trim();
    const sectionId = requestedId && !usedSectionIds.has(requestedId)
      ? requestedId
      : makeId(`section-${sectionIndex}`);
    usedSectionIds.add(sectionId);
    const sectionContent = section.content || legacyBlocksToTiptap(section.blocks);
    const content =
      section.source_code === "certifications" && sectionContent?.type === "doc"
        ? {
            ...sectionContent,
            content: (sectionContent.content || []).filter(
              (node) => node.type !== "proposalRowBreak",
            ),
          }
        : sectionContent;
    return {
      ...section,
      id: sectionId,
      blocks: Array.isArray(section.blocks) ? section.blocks : [],
      content,
    };
  });
  return {
    schema_version: Number(safe.schema_version || 1),
    metadata: safe.metadata && typeof safe.metadata === "object" ? safe.metadata : {},
    document,
    sections: normalizedSections,
    removed_sections: Array.isArray(safe.removed_sections)
      ? safe.removed_sections
      : [],
  };
}

function formatStatus(status) {
  if (status === "published") return "Finalizada";
  return "Borrador";
}

function formatQuotationAmount(amount, currencyCode) {
  const safeAmount = Number(amount || 0);
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: currencyCode || "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safeAmount);
  } catch {
    return safeAmount.toFixed(2);
  }
}

function OpportunityPickerField({
  query,
  onQueryChange,
  onSearch,
  isSearching,
  results,
  pagination,
  onPageChange,
  selected,
  onSelect,
  onClear,
}) {
  const [sortKey, setSortKey] = useState(null);
  const [sortDirection, setSortDirection] = useState("asc");

  const sortedResults = useMemo(() => {
    if (!sortKey) return results;
    const numericKeys = new Set(["opportunity_id", "total_amount"]);
    const isNumeric = numericKeys.has(sortKey);
    const factor = sortDirection === "asc" ? 1 : -1;
    return [...results].sort((a, b) => {
      if (isNumeric) {
        return (Number(a[sortKey] || 0) - Number(b[sortKey] || 0)) * factor;
      }
      return (
        String(a[sortKey] || "").localeCompare(String(b[sortKey] || "")) *
        factor
      );
    });
  }, [results, sortKey, sortDirection]);

  function handleSort(key) {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  }

  function renderSortableHeader(key, label) {
    const isActive = sortKey === key;
    return (
      <th>
        <button
          type="button"
          className="proposal-document-sort-header"
          onClick={() => handleSort(key)}
        >
          {label}
          <span className="proposal-document-sort-arrow">
            {isActive ? (sortDirection === "asc" ? "▲" : "▼") : "↕"}
          </span>
        </button>
      </th>
    );
  }

  if (selected) {
    return (
      <div className="proposal-document-quotation-picker">
        <table className="proposal-document-quotation-picker-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Cuenta</th>
              <th>Oportunidad</th>
              <th>Importe</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{selected.opportunity_id}</td>
              <td>{selected.account_name}</td>
              <td>{selected.opportunity_name}</td>
              <td>
                {formatQuotationAmount(
                  selected.total_amount,
                  selected.currency_code,
                )}
              </td>
              <td>
                <button type="button" onClick={onClear}>
                  Cambiar
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  const totalPages = Math.max(
    1,
    Math.ceil((pagination?.total || 0) / (pagination?.page_size || 1)),
  );

  return (
    <div className="proposal-document-quotation-picker">
      <div className="proposal-document-quotation-picker-search">
        <input
          type="text"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Buscar por cuenta u oportunidad"
        />
        <button type="button" onClick={onSearch} disabled={isSearching}>
          {isSearching ? "Buscando..." : "Buscar"}
        </button>
      </div>
      {results.length > 0 ? (
        <>
          <div className="proposal-document-quotation-picker-results">
            <table className="proposal-document-quotation-picker-table">
              <thead>
                <tr>
                  {renderSortableHeader("opportunity_id", "ID")}
                  {renderSortableHeader("account_name", "Cuenta")}
                  {renderSortableHeader("opportunity_name", "Oportunidad")}
                  {renderSortableHeader("total_amount", "Importe")}
                </tr>
              </thead>
              <tbody>
                {sortedResults.map((item) => (
                  <tr
                    key={item.opportunity_id}
                    onClick={() => onSelect(item)}
                    tabIndex={0}
                    role="button"
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        onSelect(item);
                      }
                    }}
                  >
                    <td>{item.opportunity_id}</td>
                    <td>{item.account_name}</td>
                    <td>{item.opportunity_name}</td>
                    <td>
                      {formatQuotationAmount(
                        item.total_amount,
                        item.currency_code,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="proposal-document-quotation-picker-pagination">
            <button
              type="button"
              onClick={() => onPageChange((pagination?.page || 1) - 1)}
              disabled={(pagination?.page || 1) <= 1}
            >
              ← Anterior
            </button>
            <span>
              Página {pagination?.page || 1} de {totalPages} (
              {pagination?.total || 0} oportunidades)
            </span>
            <button
              type="button"
              onClick={() => onPageChange((pagination?.page || 1) + 1)}
              disabled={(pagination?.page || 1) >= totalPages}
            >
              Siguiente →
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default function ProposalDocumentsPage() {
  const [documents, setDocuments] = useState([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [globalError, setGlobalError] = useState("");
  const [globalSuccess, setGlobalSuccess] = useState("");

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createOpportunity, setCreateOpportunity] = useState(null);
  const [createOpportunityQuery, setCreateOpportunityQuery] = useState("");
  const [createOpportunityResults, setCreateOpportunityResults] = useState([]);
  const [createOpportunityPagination, setCreateOpportunityPagination] =
    useState(null);
  const [isSearchingCreateOpportunity, setIsSearchingCreateOpportunity] =
    useState(false);
  const [proposalTemplates, setProposalTemplates] = useState([]);
  const [createTemplateCode, setCreateTemplateCode] = useState("generica");
  const [createFormatCode, setCreateFormatCode] = useState("basic");

  const [isCatalogModalOpen, setIsCatalogModalOpen] = useState(false);
  const [sectionCatalog, setSectionCatalog] = useState([]);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [newCatalogTitle, setNewCatalogTitle] = useState("");
  const [isSavingCatalogEntry, setIsSavingCatalogEntry] = useState(false);

  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importStep, setImportStep] = useState("upload");
  const [importFile, setImportFile] = useState(null);
  const [isUploadingImport, setIsUploadingImport] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [importTitle, setImportTitle] = useState("");
  const [isConfirmingImport, setIsConfirmingImport] = useState(false);
  const [importOpportunity, setImportOpportunity] = useState(null);
  const [importOpportunityQuery, setImportOpportunityQuery] = useState("");
  const [importOpportunityResults, setImportOpportunityResults] = useState([]);
  const [importOpportunityPagination, setImportOpportunityPagination] =
    useState(null);
  const [isSearchingImportOpportunity, setIsSearchingImportOpportunity] =
    useState(false);

  const [selectedDocumentId, setSelectedDocumentId] = useState(null);
  const [documentMeta, setDocumentMeta] = useState(null);
  const [content, setContent] = useState(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isLoadingPdf, setIsLoadingPdf] = useState(false);
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [emailForm, setEmailForm] = useState({
    to: "",
    cc: "",
    subject: "",
    message_body: "",
  });
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [aiLoadingBlockId, setAiLoadingBlockId] = useState(null);
  const [aiDraftInstructionsByBlockId, setAiDraftInstructionsByBlockId] =
    useState({});

  const contentRef = useRef(null);
  const savedContentSnapshotRef = useRef("");
  const proposalEditorRef = useRef(null);
  const draggedSectionIdRef = useRef(null);

  const pushError = useCallback((message) => {
    setGlobalError(message);
    setGlobalSuccess("");
  }, []);
  const pushSuccess = useCallback((message) => {
    setGlobalSuccess(message);
    setGlobalError("");
  }, []);

  const loadDocuments = useCallback(
    async (nextStatusFilter = statusFilter, nextSearchText = searchText) => {
      try {
        setIsLoadingList(true);
        const { data } = await api.get(
          "/api/proposal-documents/v1/proposal-documents",
          {
            params: {
              page: 1,
              page_size: 100,
              status: nextStatusFilter || undefined,
              search: nextSearchText || undefined,
            },
          },
        );
        setDocuments(Array.isArray(data?.items) ? data.items : []);
      } catch (error) {
        pushError(
          getApiErrorMessage(error, "No fue posible cargar las propuestas"),
        );
      } finally {
        setIsLoadingList(false);
      }
    },
    [pushError, searchText, statusFilter],
  );

  useEffect(() => {
    loadDocuments();
    api.get("/api/proposal-documents/v1/proposal-template-catalog")
      .then(({ data }) => {
        const templates = Array.isArray(data?.templates) ? data.templates : [];
        setProposalTemplates(templates);
        if (templates.length && !templates.some((template) => template.code === createTemplateCode)) {
          setCreateTemplateCode(templates[0].code);
        }
      })
      .catch(() => setProposalTemplates([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSectionCatalog = useCallback(async () => {
    try {
      setIsLoadingCatalog(true);
      const { data } = await api.get(
        "/api/proposal-documents/v1/proposal-document-sections/catalog",
        { params: { include_inactive: 1 } },
      );
      setSectionCatalog(Array.isArray(data?.items) ? data.items : []);
    } catch (error) {
      pushError(
        getApiErrorMessage(error, "No fue posible cargar el catálogo de secciones"),
      );
    } finally {
      setIsLoadingCatalog(false);
    }
  }, [pushError]);

  async function handleAddCatalogEntry(event) {
    event.preventDefault();
    const title = String(newCatalogTitle || "").trim();
    if (!title) {
      pushError("Debes indicar un título de sección");
      return;
    }
    try {
      setIsSavingCatalogEntry(true);
      await api.post(
        "/api/proposal-documents/v1/proposal-document-sections/catalog",
        { title },
      );
      setNewCatalogTitle("");
      await loadSectionCatalog();
    } catch (error) {
      pushError(
        getApiErrorMessage(error, "No fue posible agregar la sección"),
      );
    } finally {
      setIsSavingCatalogEntry(false);
    }
  }

  async function handleMoveCatalogEntry(code, direction) {
    setSectionCatalog((currentCatalog) => {
      const currentIndex = currentCatalog.findIndex((entry) => entry.code === code);
      const targetIndex = currentIndex + (direction === "up" ? -1 : 1);
      if (currentIndex < 0 || targetIndex < 0 || targetIndex >= currentCatalog.length) {
        return currentCatalog;
      }
      const reorderedCatalog = [...currentCatalog];
      const [movedEntry] = reorderedCatalog.splice(currentIndex, 1);
      reorderedCatalog.splice(targetIndex, 0, movedEntry);
      return reorderedCatalog;
    });

    try {
      await api.patch(
        `/api/proposal-documents/v1/proposal-document-sections/catalog/${code}`,
        { direction },
      );
    } catch (error) {
      await loadSectionCatalog();
      pushError(
        getApiErrorMessage(error, "No fue posible reordenar la sección"),
      );
    }
  }

  async function handleToggleCatalogEntry(code, isActive) {
    try {
      await api.patch(
        `/api/proposal-documents/v1/proposal-document-sections/catalog/${code}`,
        { is_active: isActive },
      );
      await loadSectionCatalog();
    } catch (error) {
      pushError(
        getApiErrorMessage(error, "No fue posible actualizar la sección"),
      );
    }
  }

  async function handleRenameCatalogEntry(code, title) {
    try {
      await api.patch(
        `/api/proposal-documents/v1/proposal-document-sections/catalog/${code}`,
        { title },
      );
      await loadSectionCatalog();
    } catch (error) {
      pushError(
        getApiErrorMessage(error, "No fue posible renombrar la sección"),
      );
    }
  }

  function handleOpenCreateModal() {
    setIsCreateModalOpen(true);
    setCreateOpportunity(null);
    setCreateOpportunityQuery("");
    setCreateOpportunityResults([]);
    setCreateOpportunityPagination(null);
    loadSectionCatalog();
    searchOpportunities({
      search: "",
      page: 1,
      setResults: setCreateOpportunityResults,
      setPagination: setCreateOpportunityPagination,
      setIsSearching: setIsSearchingCreateOpportunity,
    });
  }

  function handleOpenCatalogModal() {
    setIsCatalogModalOpen(true);
    loadSectionCatalog();
  }

  function handleOpenImportModal() {
    setImportStep("upload");
    setImportFile(null);
    setImportPreview(null);
    setImportTitle("");
    setImportOpportunity(null);
    setImportOpportunityQuery("");
    setImportOpportunityResults([]);
    setImportOpportunityPagination(null);
    setIsImportModalOpen(true);
  }

  async function searchOpportunities({
    search,
    page,
    setResults,
    setPagination,
    setIsSearching,
  }) {
    try {
      setIsSearching(true);
      const { data } = await api.get(
        "/api/proposal-documents/v1/opportunities/search",
        { params: { search: search || undefined, page: page || 1, page_size: 10 } },
      );
      setResults(Array.isArray(data?.items) ? data.items : []);
      setPagination(data?.pagination || null);
    } catch (error) {
      pushError(
        getApiErrorMessage(error, "No fue posible buscar oportunidades"),
      );
    } finally {
      setIsSearching(false);
    }
  }

  async function handleUploadImportFile(event) {
    event.preventDefault();
    if (!importFile) {
      pushError("Selecciona un archivo Word (.docx) o PDF");
      return;
    }
    try {
      setIsUploadingImport(true);
      const formData = new FormData();
      formData.append("file", importFile);
      const { data } = await api.post(
        "/api/proposal-documents/v1/proposal-documents/import",
        formData,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      setImportPreview(data);
      setImportTitle(
        String(data?.source_file_name || "").replace(/\.[^.]+$/, "") ||
          "Propuesta importada",
      );
      setImportStep("review");
      searchOpportunities({
        search: "",
        page: 1,
        setResults: setImportOpportunityResults,
        setPagination: setImportOpportunityPagination,
        setIsSearching: setIsSearchingImportOpportunity,
      });
    } catch (error) {
      pushError(
        getApiErrorMessage(error, "No fue posible procesar el archivo"),
      );
    } finally {
      setIsUploadingImport(false);
    }
  }

  function handleUpdateImportSection(index, patch) {
    setImportPreview((prev) => {
      if (!prev) return prev;
      const sections = prev.sections.map((section, sectionIndex) =>
        sectionIndex === index ? { ...section, ...patch } : section,
      );
      return { ...prev, sections };
    });
  }

  function handleRemoveImportSection(index) {
    setImportPreview((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        sections: prev.sections.filter((_section, i) => i !== index),
      };
    });
  }

  async function handleConfirmImport(event) {
    event.preventDefault();
    const title = String(importTitle || "").trim();
    if (!title) {
      pushError("Debes indicar un título para la propuesta");
      return;
    }
    if (!importOpportunity) {
      pushError("Debes seleccionar la oportunidad de origen");
      return;
    }
    if (!importPreview?.sections?.length) {
      pushError("La propuesta debe tener al menos una sección");
      return;
    }
    try {
      setIsConfirmingImport(true);
      const { data } = await api.post(
        "/api/proposal-documents/v1/proposal-documents/import/confirm",
        {
          import_id: importPreview.import_id,
          title,
          opportunity_id: importOpportunity.opportunity_id,
          sections: importPreview.sections,
        },
      );
      const documentId = Number(data?.proposal_document_id || 0);
      setIsImportModalOpen(false);
      pushSuccess("Propuesta importada correctamente");
      await loadDocuments();
      if (documentId > 0) {
        setSelectedDocumentId(documentId);
      }
    } catch (error) {
      pushError(
        getApiErrorMessage(error, "No fue posible crear la propuesta importada"),
      );
    } finally {
      setIsConfirmingImport(false);
    }
  }

  const loadDocumentDetail = useCallback(
    async (documentId) => {
      if (!documentId) return;
      try {
        setIsLoadingDetail(true);
        const { data } = await api.get(
          `/api/proposal-documents/v1/proposal-documents/${documentId}`,
        );
        setDocumentMeta(data?.proposal_document || null);
        const nextContent = normalizeContent(data?.active_version?.content);
        setContent(nextContent);
        contentRef.current = nextContent;
        savedContentSnapshotRef.current = JSON.stringify(nextContent);
        setHasUnsavedChanges(false);
      } catch (error) {
        pushError(
          getApiErrorMessage(error, "No fue posible cargar la propuesta"),
        );
      } finally {
        setIsLoadingDetail(false);
      }
    },
    [pushError],
  );

  useEffect(() => {
    if (selectedDocumentId) {
      loadDocumentDetail(selectedDocumentId);
    }
  }, [selectedDocumentId, loadDocumentDetail]);

  function updateContent(updater) {
    const draft = normalizeContent(contentRef.current || content);
    const next = updater(draft);
    contentRef.current = next;
    setContent(next);
    setHasUnsavedChanges(
      JSON.stringify(next) !== savedContentSnapshotRef.current,
    );
  }

  async function handleSaveChanges() {
    if (!selectedDocumentId || !contentRef.current) return false;
    const editorDocument = proposalEditorRef.current?.getDocument();
    const contentToSave = editorDocument && contentRef.current.schema_version >= 3
      ? { ...contentRef.current, schema_version: 3, document: editorDocument }
      : contentRef.current;
    contentRef.current = contentToSave;
    setContent(contentToSave);
    try {
      setIsSaving(true);
      await api.patch(
        `/api/proposal-documents/v1/proposal-documents/${selectedDocumentId}`,
        { content: contentToSave },
      );
      savedContentSnapshotRef.current = JSON.stringify(contentToSave);
      setHasUnsavedChanges(false);
      pushSuccess("Cambios guardados");
      return true;
    } catch (error) {
      pushError(
        getApiErrorMessage(error, "No fue posible guardar los cambios"),
      );
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCreateDocument(event) {
    event.preventDefault();
    const title = String(newTitle || "").trim();
    if (!title) {
      pushError("Debes indicar un título para la propuesta");
      return;
    }
    if (!createOpportunity) {
      pushError("Debes seleccionar la oportunidad de origen");
      return;
    }
    try {
      setIsCreating(true);
      const { data } = await api.post(
        "/api/proposal-documents/v1/proposal-documents",
        {
          title,
          opportunity_id: createOpportunity.opportunity_id,
          template_code: createTemplateCode,
          format_code: createFormatCode,
        },
      );
      const documentId = Number(data?.proposal_document_id || 0);
      setIsCreateModalOpen(false);
      setNewTitle("");
      pushSuccess("Propuesta creada correctamente");
      await loadDocuments();
      if (documentId > 0) {
        setSelectedDocumentId(documentId);
      }
    } catch (error) {
      pushError(getApiErrorMessage(error, "No fue posible crear la propuesta"));
    } finally {
      setIsCreating(false);
    }
  }

  async function handlePublish() {
    if (!selectedDocumentId) return;
    try {
      setIsPublishing(true);
      await api.post(
        `/api/proposal-documents/v1/proposal-documents/${selectedDocumentId}/publish`,
      );
      pushSuccess("Propuesta publicada");
      await loadDocuments();
      await loadDocumentDetail(selectedDocumentId);
    } catch (error) {
      pushError(
        getApiErrorMessage(error, "No fue posible publicar la propuesta"),
      );
    } finally {
      setIsPublishing(false);
    }
  }

  async function handleViewPdf() {
    if (!selectedDocumentId || isLoadingPdf) return;
    try {
      setIsLoadingPdf(true);
      if (hasUnsavedChanges) {
        const saved = await handleSaveChanges();
        if (!saved) return;
      }
      const response = await api.get(
        `/api/proposal-documents/v1/proposal-documents/${selectedDocumentId}/pdf`,
        { responseType: "blob" },
      );
      const objectUrl = window.URL.createObjectURL(response.data);
      window.open(objectUrl, "_blank");
    } catch (error) {
      pushError(
        getApiErrorMessage(error, "No fue posible generar el PDF"),
      );
    } finally {
      setIsLoadingPdf(false);
    }
  }

  function handleOpenEmailModal() {
    setEmailForm({
      to: "",
      cc: "",
      subject: `Propuesta: ${documentMeta?.title || ""}`.trim(),
      message_body: "Adjunto la propuesta para su revisión.",
    });
    setIsEmailModalOpen(true);
  }

  async function handleSendEmail(event) {
    event.preventDefault();
    if (!selectedDocumentId) return;
    try {
      setIsSendingEmail(true);
      await api.post(
        `/api/proposal-documents/v1/proposal-documents/${selectedDocumentId}/send-email`,
        emailForm,
      );
      setIsEmailModalOpen(false);
      pushSuccess("Correo enviado correctamente");
    } catch (error) {
      const reason = String(error?.response?.data?.reason || "");
      if (reason === "google_reconnect_required") {
        pushError(
          "Debes conectar Google Mail desde tu perfil, arriba a la derecha, antes de enviar propuestas por correo.",
        );
      } else if (reason === "google_scope_missing") {
        pushError(
          "Tu conexión de Google no incluye permiso de envío. Reconéctala y acepta el permiso solicitado.",
        );
      } else {
        pushError(getApiErrorMessage(error, "No fue posible enviar el correo"));
      }
    } finally {
      setIsSendingEmail(false);
    }
  }

  async function handleDeleteDocument(item) {
    const documentId = Number(item?.id || 0);
    if (!documentId) return;
    if (String(item?.status) !== "draft") {
      pushError("Solo se puede eliminar una propuesta en estado borrador");
      return;
    }
    const shouldDelete = window.confirm(
      "¿Eliminar esta propuesta? Esta acción no se puede deshacer.",
    );
    if (!shouldDelete) return;

    try {
      setDeletingId(documentId);
      await api.delete(
        `/api/proposal-documents/v1/proposal-documents/${documentId}`,
      );
      setDocuments((prev) => prev.filter((row) => Number(row.id) !== documentId));
      if (Number(selectedDocumentId) === documentId) {
        setSelectedDocumentId(null);
        setDocumentMeta(null);
        setContent(null);
      }
      pushSuccess("Propuesta eliminada");
    } catch (error) {
      pushError(
        getApiErrorMessage(error, "No fue posible eliminar la propuesta"),
      );
    } finally {
      setDeletingId(null);
    }
  }

  function handleAddSection() {
    const isWysiwygDocument = content?.schema_version >= 3 && content.document?.type === "doc";
    updateContent((draft) => {
      if (isWysiwygDocument && draft.schema_version >= 3 && draft.document?.type === "doc") {
        return {
          ...draft,
          schema_version: 3,
          document: {
            ...draft.document,
            content: [
              ...(draft.document.content || []),
              {
                type: "proposalSection",
                content: [
                  {
                    type: "heading",
                    attrs: { level: 2 },
                    content: [{ type: "text", text: "Nueva sección" }],
                  },
                  { type: "paragraph" },
                ],
              },
            ],
          },
        };
      }
      return {
        ...draft,
        sections: [...draft.sections, buildEmptySection()],
      };
    });
    if (isWysiwygDocument) {
      window.setTimeout(() => proposalEditorRef.current?.focusAtEnd(), 0);
    }
  }

  function handleRemoveSection(sectionId) {
    updateContent((draft) => {
      const removed = draft.sections.find((section) => section.id === sectionId);
      if (!removed) return draft;
      return {
        ...draft,
        sections: draft.sections.filter((section) => section.id !== sectionId),
        removed_sections: [
          ...draft.removed_sections,
          { ...removed, removed_at: new Date().toISOString() },
        ],
      };
    });
  }

  function handleRestoreSection(sectionId) {
    updateContent((draft) => {
      const restored = draft.removed_sections.find(
        (section) => section.id === sectionId,
      );
      if (!restored) return draft;
      const { removed_at: _removedAt, ...cleanSection } = restored;
      return {
        ...draft,
        sections: [...draft.sections, cleanSection],
        removed_sections: draft.removed_sections.filter(
          (section) => section.id !== sectionId,
        ),
      };
    });
  }

  function handleMoveSection(sectionIndex, direction) {
    updateContent((draft) => {
      const targetIndex = sectionIndex + direction;
      if (
        sectionIndex < 0 ||
        sectionIndex >= draft.sections.length ||
        targetIndex < 0 ||
        targetIndex >= draft.sections.length
      ) {
        return draft;
      }
      const sections = [...draft.sections];
      const [moved] = sections.splice(sectionIndex, 1);
      sections.splice(targetIndex, 0, moved);
      return { ...draft, sections };
    });
  }

  function handleReorderSectionByDrag(draggedSectionId, targetSectionId) {
    if (!draggedSectionId || draggedSectionId === targetSectionId) return;
    updateContent((draft) => {
      const sourceIndex = draft.sections.findIndex(
        (section) => section.id === draggedSectionId,
      );
      const targetIndex = draft.sections.findIndex(
        (section) => section.id === targetSectionId,
      );
      if (sourceIndex < 0 || targetIndex < 0) return draft;
      const sections = [...draft.sections];
      const [moved] = sections.splice(sourceIndex, 1);
      sections.splice(targetIndex, 0, moved);
      return { ...draft, sections };
    });
  }

  function handleRenameSection(sectionId, title) {
    updateContent((draft) => ({
      ...draft,
      sections: draft.sections.map((section) =>
        section.id === sectionId ? { ...section, title } : section,
      ),
    }));
  }

  function handleAddBlock(sectionId, type) {
    updateContent((draft) => ({
      ...draft,
      sections: draft.sections.map((section) =>
        section.id === sectionId
          ? { ...section, blocks: [...section.blocks, buildBlock(type)] }
          : section,
      ),
    }));
  }

  function handleRemoveBlock(sectionId, blockId) {
    updateContent((draft) => ({
      ...draft,
      sections: draft.sections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              blocks: section.blocks.filter((block) => block.id !== blockId),
            }
          : section,
      ),
    }));
  }

  function handleMoveBlock(sectionId, blockId, direction) {
    updateContent((draft) => ({
      ...draft,
      sections: draft.sections.map((section) => {
        if (section.id !== sectionId) return section;
        const index = section.blocks.findIndex((block) => block.id === blockId);
        const targetIndex = index + direction;
        if (
          index < 0 ||
          targetIndex < 0 ||
          targetIndex >= section.blocks.length
        ) {
          return section;
        }
        const blocks = [...section.blocks];
        const [moved] = blocks.splice(index, 1);
        blocks.splice(targetIndex, 0, moved);
        return { ...section, blocks };
      }),
    }));
  }

  function handleUpdateBlock(sectionId, blockId, patch) {
    updateContent((draft) => ({
      ...draft,
      sections: draft.sections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              blocks: section.blocks.map((block) =>
                block.id === blockId ? { ...block, ...patch } : block,
              ),
            }
          : section,
      ),
    }));
  }

  function handleAddListItem(sectionId, blockId) {
    updateContent((draft) => ({
      ...draft,
      sections: draft.sections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              blocks: section.blocks.map((block) =>
                block.id === blockId
                  ? { ...block, items: [...(block.items || []), ""] }
                  : block,
              ),
            }
          : section,
      ),
    }));
  }

  function handleUpdateListItem(sectionId, blockId, itemIndex, value) {
    updateContent((draft) => ({
      ...draft,
      sections: draft.sections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              blocks: section.blocks.map((block) =>
                block.id === blockId
                  ? {
                      ...block,
                      items: block.items.map((item, index) =>
                        index === itemIndex ? value : item,
                      ),
                    }
                  : block,
              ),
            }
          : section,
      ),
    }));
  }

  function handleRemoveListItem(sectionId, blockId, itemIndex) {
    updateContent((draft) => ({
      ...draft,
      sections: draft.sections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              blocks: section.blocks.map((block) =>
                block.id === blockId
                  ? {
                      ...block,
                      items: block.items.filter(
                        (_item, index) => index !== itemIndex,
                      ),
                    }
                  : block,
              ),
            }
          : section,
      ),
    }));
  }

  function scrollToSection(sectionId) {
    const element = document.getElementById(`proposal-section-${sectionId}`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  async function handleGenerateBlockText({
    sectionId,
    sectionTitle,
    block,
    action,
  }) {
    if (!selectedDocumentId || aiLoadingBlockId) return;

    let targetLanguage;
    if (action === "translate") {
      targetLanguage = window.prompt(
        "¿A qué idioma traducimos? (ej. inglés, portugués)",
        "inglés",
      );
      if (!targetLanguage) return;
    }

    try {
      setAiLoadingBlockId(block.id);
      const { data } = await api.post(
        `/api/proposal-documents/v1/proposal-documents/${selectedDocumentId}/ai/section`,
        {
          action,
          section_title: sectionTitle,
          current_text: block.text || "",
          instructions: aiDraftInstructionsByBlockId[block.id] || "",
          target_language: targetLanguage,
        },
      );
      handleUpdateBlock(sectionId, block.id, {
        text: data?.text || block.text || "",
        ai_generated: true,
      });
    } catch (error) {
      pushError(
        getApiErrorMessage(error, "No fue posible generar contenido con IA"),
      );
    } finally {
      setAiLoadingBlockId(null);
    }
  }

  const sections = content?.sections || [];
  const removedSections = content?.removed_sections || [];
  const isPublished = documentMeta?.status === "published";

  return (
    <div className={`proposal-document-module-page${selectedDocumentId ? "" : " is-list-view"}`}>
      <header className="proposal-document-module-head">
        <div>
          <h2>Propuestas (nuevo)</h2>
          <p>
            Crea y edita propuestas técnicas de forma rápida y ordenada, sin
            precios ni configuración compleja por sección.
          </p>
        </div>
      </header>

      {globalError ? (
        <div className="proposal-document-banner proposal-document-banner-error">
          {globalError}
          <button type="button" onClick={() => setGlobalError("")}>
            ×
          </button>
        </div>
      ) : null}
      {globalSuccess ? (
        <div className="proposal-document-banner proposal-document-banner-success">
          {globalSuccess}
          <button type="button" onClick={() => setGlobalSuccess("")}>
            ×
          </button>
        </div>
      ) : null}

      {!selectedDocumentId ? (
        <section className="proposal-document-card">
          <div className="proposal-document-list-head">
            <h3>Propuestas</h3>
            <div className="proposal-document-list-head-actions">
              <button
                type="button"
                className="proposal-document-primary-button"
                onClick={handleOpenCreateModal}
              >
                Nueva propuesta
              </button>
            </div>
          </div>

          <div className="proposal-document-list-filters">
            <input
              type="text"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Buscar por título"
            />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="">Todos los estados</option>
              <option value="draft">Borrador</option>
              <option value="published">Publicada</option>
            </select>
            <button
              type="button"
              onClick={() => loadDocuments()}
              disabled={isLoadingList}
            >
              {isLoadingList ? "Cargando..." : "Refrescar"}
            </button>
          </div>

          <div className="proposal-document-table-wrap">
            <table className="proposal-document-table">
              <thead>
                <tr>
                  <th>Título</th>
                  <th>Cliente</th>
                  <th>Vendedor</th>
                  <th>Estado</th>
                  <th>Actualizada</th>
                  <th className="proposal-document-actions-column">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {documents.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No hay propuestas registradas</td>
                  </tr>
                ) : (
                  documents.map((item) => (
                    <tr
                      key={item.id}
                      onDoubleClick={() => setSelectedDocumentId(Number(item.id))}
                      title="Doble clic para abrir"
                    >
                      <td>{item.title}</td>
                      <td>{item.client_name || "-"}</td>
                      <td>{item.seller_name || "-"}</td>
                      <td>
                        <span
                          className={`proposal-document-status-badge proposal-document-status-${item.status}`}
                        >
                          {formatStatus(item.status)}
                        </span>
                      </td>
                      <td className="proposal-document-updated-cell">
                        {item.updated_at
                          ? new Date(item.updated_at).toLocaleString()
                          : "-"}
                      </td>
                      <td className="proposal-document-actions-cell">
                        {item.status === "draft" ? (
                          <button
                            type="button"
                            className="proposal-document-icon-button"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleDeleteDocument(item);
                            }}
                            disabled={deletingId === Number(item.id)}
                            aria-label="Eliminar propuesta"
                            title="Eliminar propuesta"
                          >
                            🗑
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="proposal-document-editor">
          <button
            type="button"
            className="proposal-document-back-button"
            onClick={() => setSelectedDocumentId(null)}
          >
            ← Volver al listado
          </button>

          {isLoadingDetail || !documentMeta ? (
            <p>Cargando propuesta...</p>
          ) : (
            <div className="proposal-document-editor-layout">
              <div className="proposal-document-editor-actions">
                <div className="proposal-document-toolbar-summary">
                  <div className="proposal-document-sidebar-status">
                    <span
                      className={`proposal-document-status-badge proposal-document-status-${documentMeta.status}`}
                    >
                      {formatStatus(documentMeta.status)}
                    </span>
                    <span className="proposal-document-save-indicator">
                      {isSaving
                        ? "Guardando..."
                        : hasUnsavedChanges
                          ? "Cambios sin guardar"
                          : "Guardado"}
                    </span>
                  </div>
                  <label className="proposal-document-format-field">
                    <span>Formato</span>
                    <select value="basic" onChange={() => updateContent((draft) => ({ ...draft, metadata: { ...draft.metadata, format_code: "basic", format_snapshot: getProposalFormat("basic") } }))} aria-label="Formato visual">
                      <option value="basic">Básico</option>
                    </select>
                  </label>
                </div>
                <div className="proposal-document-sidebar-actions">
                  <div className="proposal-document-action-group">
                    <span>Edición</span>
                    {content?.schema_version >= 3 && content.document?.type === "doc" ? (
                      <button type="button" className="proposal-document-action-secondary" onClick={handleAddSection}>
                        Agregar sección
                      </button>
                    ) : null}
                    <button type="button" className="proposal-document-action-primary" onClick={handleSaveChanges} disabled={isSaving}>
                      {isSaving ? "Guardando..." : "Guardar cambios"}
                    </button>
                  </div>
                  <div className="proposal-document-action-group proposal-document-action-group-review">
                    <span>Revisar y enviar</span>
                    <button type="button" className="proposal-document-action-secondary" onClick={handleViewPdf} disabled={isLoadingPdf}>
                      {isLoadingPdf ? "Generando..." : "Ver PDF"}
                    </button>
                    <button
                      type="button"
                      className="proposal-document-action-secondary"
                      onClick={handleOpenEmailModal}
                      disabled={hasUnsavedChanges || isSaving || isSendingEmail}
                      title={hasUnsavedChanges ? "Guarda los cambios antes de enviar por correo" : "Enviar por correo"}
                    >
                      Enviar por correo
                    </button>
                  </div>
                  <div className="proposal-document-action-group proposal-document-action-group-close">
                    <span>Cierre</span>
                    <button type="button" className="proposal-document-action-publish" onClick={handlePublish} disabled={isPublishing || isPublished}>
                      {isPublished ? "Finalizada" : isPublishing ? "Finalizando..." : "Finalizar propuesta"}
                    </button>
                  </div>
                </div>
              </div>

              <div className="proposal-document-canvas">
                {content?.schema_version >= 3 && content.document?.type === "doc" ? (
                  <article className="proposal-document-wysiwyg-page">
                    <ProposalRichTextEditor
                      ref={proposalEditorRef}
                      content={content.document}
                      printMode
                      keepPastedContentInSection
                      formatCode={content?.metadata?.format_code || "basic"}
                      onChange={(document) =>
                        updateContent((draft) => ({ ...draft, schema_version: 3, document }))
                      }
                    />
                  </article>
                ) : sections.length === 0 ? (
                  <div className="proposal-document-empty-state">
                    <p>Esta propuesta todavía no tiene secciones.</p>
                    <button type="button" onClick={handleAddSection}>
                      Agregar primera sección
                    </button>
                  </div>
                ) : (
                  sections.map((section, sectionIndex) => (
                    <article
                      key={`${section.id}-${sectionIndex}`}
                      id={`proposal-section-${section.id}`}
                      className={`proposal-document-section${section.source_code === "certifications" ? " is-certifications-section" : ""}`}
                      draggable
                      onDragStart={() => {
                        draggedSectionIdRef.current = section.id;
                      }}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        handleReorderSectionByDrag(
                          draggedSectionIdRef.current,
                          section.id,
                        );
                        draggedSectionIdRef.current = null;
                      }}
                    >
                      <div className="proposal-document-section-head">
                        <span
                          className="proposal-document-drag-handle"
                          title="Arrastra para reordenar"
                          aria-hidden="true"
                        >
                          ⠿
                        </span>
                        <input
                          type="text"
                          className="proposal-document-section-title"
                          value={section.title}
                          onChange={(event) =>
                            handleRenameSection(section.id, event.target.value)
                          }
                        />
                        <div className="proposal-document-section-controls">
                          <button
                            type="button"
                            onClick={() => handleMoveSection(sectionIndex, -1)}
                            disabled={sectionIndex === 0}
                            aria-label="Mover sección arriba"
                            title="Mover arriba"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMoveSection(sectionIndex, 1)}
                            disabled={sectionIndex === sections.length - 1}
                            aria-label="Mover sección abajo"
                            title="Mover abajo"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="proposal-document-remove-section-button"
                            onClick={() => {
                              if (window.confirm("¿Eliminar esta sección? Esta acción no se puede deshacer.")) {
                                handleRemoveSection(section.id);
                              }
                            }}
                            aria-label="Quitar sección"
                            title="Quitar sección"
                          >
                            Quitar
                          </button>
                        </div>
                      </div>

                      {section.content ? (
                        <ProposalRichTextEditor
                          content={section.content}
                          onChange={(nextSectionContent) =>
                            updateContent((draft) => ({
                              ...draft,
                              schema_version: 2,
                              sections: draft.sections.map((row) =>
                                row.id === section.id
                                  ? { ...row, content: nextSectionContent }
                                  : row,
                              ),
                            }))
                          }
                        />
                      ) : section.blocks.length === 0 ? (
                        <div className="proposal-document-section-empty">
                          <p>Sección vacía. Agrega un bloque para comenzar.</p>
                          <button
                            type="button"
                            className="proposal-document-ai-button"
                            onClick={() => {
                              const newBlock = buildBlock("paragraph");
                              updateContent((draft) => ({
                                ...draft,
                                sections: draft.sections.map((row) =>
                                  row.id === section.id
                                    ? { ...row, blocks: [...row.blocks, newBlock] }
                                    : row,
                                ),
                              }));
                              handleGenerateBlockText({
                                sectionId: section.id,
                                sectionTitle: section.title,
                                block: newBlock,
                                action: "draft",
                              });
                            }}
                            disabled={Boolean(aiLoadingBlockId)}
                          >
                            ✨ Redactar con IA
                          </button>
                        </div>
                      ) : (
                        section.blocks.map((block, blockIndex) => (
                          <div key={block.id} className="proposal-document-block">
                            <div className="proposal-document-block-toolbar">
                              <span className="proposal-document-block-type">
                                {BLOCK_TYPE_LABELS[block.type] || block.type}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  handleMoveBlock(section.id, block.id, -1)
                                }
                                disabled={blockIndex === 0}
                                aria-label="Mover bloque arriba"
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleMoveBlock(section.id, block.id, 1)
                                }
                                disabled={blockIndex === section.blocks.length - 1}
                                aria-label="Mover bloque abajo"
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleRemoveBlock(section.id, block.id)
                                }
                                aria-label="Eliminar bloque"
                              >
                                Eliminar
                              </button>
                            </div>

                            {block.type === "heading" ? (
                              <input
                                type="text"
                                value={block.text || ""}
                                placeholder="Encabezado"
                                onChange={(event) =>
                                  handleUpdateBlock(section.id, block.id, {
                                    text: event.target.value,
                                  })
                                }
                              />
                            ) : null}

                            {block.type === "paragraph" ? (
                              <textarea
                                value={block.text || ""}
                                placeholder="Escribe el contenido de este párrafo..."
                                onChange={(event) =>
                                  handleUpdateBlock(section.id, block.id, {
                                    text: event.target.value,
                                  })
                                }
                              />
                            ) : null}

                            {block.type === "paragraph" ? (
                              <div className="proposal-document-block-ai-bar">
                                {String(block.text || "").trim() ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleGenerateBlockText({
                                          sectionId: section.id,
                                          sectionTitle: section.title,
                                          block,
                                          action: "improve",
                                        })
                                      }
                                      disabled={aiLoadingBlockId === block.id}
                                    >
                                      {aiLoadingBlockId === block.id
                                        ? "Generando..."
                                        : "✨ Mejorar"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleGenerateBlockText({
                                          sectionId: section.id,
                                          sectionTitle: section.title,
                                          block,
                                          action: "shorten",
                                        })
                                      }
                                      disabled={aiLoadingBlockId === block.id}
                                    >
                                      ✨ Acortar
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleGenerateBlockText({
                                          sectionId: section.id,
                                          sectionTitle: section.title,
                                          block,
                                          action: "translate",
                                        })
                                      }
                                      disabled={aiLoadingBlockId === block.id}
                                    >
                                      ✨ Traducir
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <input
                                      type="text"
                                      className="proposal-document-ai-instructions-input"
                                      placeholder="Instrucciones para la IA (opcional)"
                                      value={
                                        aiDraftInstructionsByBlockId[block.id] || ""
                                      }
                                      onChange={(event) =>
                                        setAiDraftInstructionsByBlockId((prev) => ({
                                          ...prev,
                                          [block.id]: event.target.value,
                                        }))
                                      }
                                    />
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleGenerateBlockText({
                                          sectionId: section.id,
                                          sectionTitle: section.title,
                                          block,
                                          action: "draft",
                                        })
                                      }
                                      disabled={aiLoadingBlockId === block.id}
                                    >
                                      {aiLoadingBlockId === block.id
                                        ? "Generando..."
                                        : "✨ Redactar con IA"}
                                    </button>
                                  </>
                                )}
                              </div>
                            ) : null}

                            {block.type === "list" ? (
                              <div className="proposal-document-list-block">
                                {(block.items || []).map((item, itemIndex) => (
                                  <div
                                    key={`${block.id}-item-${itemIndex}`}
                                    className="proposal-document-list-item-row"
                                  >
                                    <input
                                      type="text"
                                      value={item}
                                      placeholder="Elemento de la lista"
                                      onChange={(event) =>
                                        handleUpdateListItem(
                                          section.id,
                                          block.id,
                                          itemIndex,
                                          event.target.value,
                                        )
                                      }
                                    />
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleRemoveListItem(
                                          section.id,
                                          block.id,
                                          itemIndex,
                                        )
                                      }
                                      aria-label="Eliminar elemento"
                                    >
                                      ×
                                    </button>
                                  </div>
                                ))}
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleAddListItem(section.id, block.id)
                                  }
                                >
                                  + Elemento
                                </button>
                              </div>
                            ) : null}

                            {block.type === "image" && block.image?.fileUrl ? (
                              <figure className="proposal-document-image-block">
                                <img
                                  src={block.image.fileUrl}
                                  alt={block.image.altText || "Imagen de propuesta"}
                                />
                                {block.image.caption ? (
                                  <figcaption>{block.image.caption}</figcaption>
                                ) : null}
                              </figure>
                            ) : null}
                          </div>
                        ))
                      )}

                    </article>
                  ))
                )}

                {content?.schema_version >= 3 ? null : (
                  <button
                    type="button"
                    className="proposal-document-add-section-button"
                    onClick={handleAddSection}
                  >
                    + Agregar sección
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {isCreateModalOpen ? (
        <div className="proposal-document-modal-overlay">
          <div className="proposal-document-modal proposal-document-modal-wide">
            <h3>Nueva propuesta</h3>
            <form onSubmit={handleCreateDocument}>
              <div className="proposal-document-field-block">
                Oportunidad de origen
                <OpportunityPickerField
                  query={createOpportunityQuery}
                  onQueryChange={setCreateOpportunityQuery}
                  onSearch={() =>
                    searchOpportunities({
                      search: createOpportunityQuery,
                      page: 1,
                      setResults: setCreateOpportunityResults,
                      setPagination: setCreateOpportunityPagination,
                      setIsSearching: setIsSearchingCreateOpportunity,
                    })
                  }
                  isSearching={isSearchingCreateOpportunity}
                  results={createOpportunityResults}
                  pagination={createOpportunityPagination}
                  onPageChange={(page) =>
                    searchOpportunities({
                      search: createOpportunityQuery,
                      page,
                      setResults: setCreateOpportunityResults,
                      setPagination: setCreateOpportunityPagination,
                      setIsSearching: setIsSearchingCreateOpportunity,
                    })
                  }
                  selected={createOpportunity}
                  onSelect={setCreateOpportunity}
                  onClear={() => setCreateOpportunity(null)}
                />
              </div>
              <label>
                Título
                <input
                  type="text"
                  value={newTitle}
                  onChange={(event) => setNewTitle(event.target.value)}
                  placeholder="Nombre de la propuesta"
                  required
                  autoFocus
                />
              </label>
              <label>
                Tipo de propuesta
                <select
                  value={createTemplateCode}
                  onChange={(event) => setCreateTemplateCode(event.target.value)}
                  required
                >
                  {proposalTemplates.map((template) => (
                    <option key={template.code} value={template.code}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Formato visual
                <select value={createFormatCode} onChange={(event) => setCreateFormatCode(event.target.value)} required>
                  <option value="basic">Básico</option>
                </select>
              </label>
              <div className="proposal-document-modal-actions">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                >
                  Cancelar
                </button>
                <button type="submit" disabled={isCreating}>
                  {isCreating ? "Creando..." : "Crear"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {isCatalogModalOpen ? (
        <div className="proposal-document-modal-overlay">
          <div className="proposal-document-modal proposal-document-catalog-modal">
            <h3>Secciones estándar</h3>
            <p className="proposal-document-modal-hint">
              Estas secciones se usan al crear una propuesta nueva con
              "Usar secciones estándar" activado. Todas son removibles al
              editar un documento puntual.
            </p>

            <form
              className="proposal-document-catalog-add-form"
              onSubmit={handleAddCatalogEntry}
            >
              <input
                type="text"
                value={newCatalogTitle}
                onChange={(event) => setNewCatalogTitle(event.target.value)}
                placeholder="Nombre de la nueva sección"
              />
              <button type="submit" disabled={isSavingCatalogEntry}>
                {isSavingCatalogEntry ? "Agregando..." : "+ Agregar"}
              </button>
            </form>

            <div className="proposal-document-catalog-list">
              {isLoadingCatalog ? (
                <p>Cargando...</p>
              ) : (
                sectionCatalog.map((entry, index) => (
                  <div
                    key={entry.code}
                    className={`proposal-document-catalog-row ${
                      entry.is_active ? "" : "is-inactive"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleMoveCatalogEntry(entry.code, "up")}
                      disabled={index === 0}
                      aria-label="Mover arriba"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveCatalogEntry(entry.code, "down")}
                      disabled={index === sectionCatalog.length - 1}
                      aria-label="Mover abajo"
                    >
                      ↓
                    </button>
                    <input
                      type="text"
                      value={entry.title}
                      onChange={(event) => {
                        const title = event.target.value;
                        setSectionCatalog((prev) =>
                          prev.map((row) =>
                            row.code === entry.code ? { ...row, title } : row,
                          ),
                        );
                      }}
                      onBlur={(event) =>
                        handleRenameCatalogEntry(entry.code, event.target.value)
                      }
                    />
                    <label className="proposal-document-checkbox-label">
                      <input
                        type="checkbox"
                        checked={entry.is_active}
                        onChange={(event) =>
                          handleToggleCatalogEntry(
                            entry.code,
                            event.target.checked,
                          )
                        }
                      />
                      Activa
                    </label>
                  </div>
                ))
              )}
            </div>

            <div className="proposal-document-modal-actions">
              <button
                type="button"
                onClick={() => setIsCatalogModalOpen(false)}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isImportModalOpen ? (
        <div className="proposal-document-modal-overlay">
          <div className="proposal-document-modal proposal-document-import-modal">
            <h3>Importar Word/PDF</h3>

            {importStep === "upload" ? (
              <form onSubmit={handleUploadImportFile}>
                <p className="proposal-document-modal-hint">
                  Se extrae solo el texto del archivo (sin imágenes ni tablas)
                  y se propone una distribución por secciones que podrás
                  revisar antes de crear la propuesta.
                </p>
                <label>
                  Archivo (.docx o .pdf)
                  <input
                    type="file"
                    accept=".docx,.pdf"
                    onChange={(event) =>
                      setImportFile(event.target.files?.[0] || null)
                    }
                    required
                  />
                </label>
                <div className="proposal-document-modal-actions">
                  <button
                    type="button"
                    onClick={() => setIsImportModalOpen(false)}
                  >
                    Cancelar
                  </button>
                  <button type="submit" disabled={isUploadingImport}>
                    {isUploadingImport ? "Procesando..." : "Analizar archivo"}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleConfirmImport}>
                <label>
                  Título de la propuesta
                  <input
                    type="text"
                    value={importTitle}
                    onChange={(event) => setImportTitle(event.target.value)}
                    required
                  />
                </label>
                <div className="proposal-document-field-block">
                  Oportunidad de origen
                  <OpportunityPickerField
                    query={importOpportunityQuery}
                    onQueryChange={setImportOpportunityQuery}
                    onSearch={() =>
                      searchOpportunities({
                        search: importOpportunityQuery,
                        page: 1,
                        setResults: setImportOpportunityResults,
                        setPagination: setImportOpportunityPagination,
                        setIsSearching: setIsSearchingImportOpportunity,
                      })
                    }
                    isSearching={isSearchingImportOpportunity}
                    results={importOpportunityResults}
                    pagination={importOpportunityPagination}
                    onPageChange={(page) =>
                      searchOpportunities({
                        search: importOpportunityQuery,
                        page,
                        setResults: setImportOpportunityResults,
                        setPagination: setImportOpportunityPagination,
                        setIsSearching: setIsSearchingImportOpportunity,
                      })
                    }
                    selected={importOpportunity}
                    onSelect={setImportOpportunity}
                    onClear={() => setImportOpportunity(null)}
                  />
                </div>
                <p className="proposal-document-modal-hint">
                  Revisa las secciones detectadas. Puedes editar el título y
                  el texto, o quitar las que no apliquen.
                </p>
                <div className="proposal-document-import-review-list">
                  {(importPreview?.sections || []).map((section, index) => (
                    <div
                      key={`${section.title}-${index}`}
                      className="proposal-document-import-review-row"
                    >
                      <div className="proposal-document-import-review-head">
                        <input
                          type="text"
                          value={section.title}
                          onChange={(event) =>
                            handleUpdateImportSection(index, {
                              title: event.target.value,
                            })
                          }
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveImportSection(index)}
                          aria-label="Quitar sección"
                        >
                          Quitar
                        </button>
                      </div>
                      <textarea
                        value={section.text}
                        onChange={(event) =>
                          handleUpdateImportSection(index, {
                            text: event.target.value,
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
                <div className="proposal-document-modal-actions">
                  <button
                    type="button"
                    onClick={() => setImportStep("upload")}
                  >
                    Volver
                  </button>
                  <button type="submit" disabled={isConfirmingImport}>
                    {isConfirmingImport ? "Creando..." : "Crear propuesta"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}

      {isEmailModalOpen ? (
        <div className="proposal-document-modal-overlay">
          <div className="proposal-document-modal">
            <h3>Enviar propuesta por correo</h3>
            <form onSubmit={handleSendEmail}>
              <label>
                Para
                <input
                  type="email"
                  value={emailForm.to}
                  onChange={(event) =>
                    setEmailForm((prev) => ({ ...prev, to: event.target.value }))
                  }
                  required
                />
              </label>
              <label>
                CC (opcional)
                <input
                  type="text"
                  value={emailForm.cc}
                  onChange={(event) =>
                    setEmailForm((prev) => ({ ...prev, cc: event.target.value }))
                  }
                  placeholder="correo1@dominio.com, correo2@dominio.com"
                />
              </label>
              <label>
                Asunto
                <input
                  type="text"
                  value={emailForm.subject}
                  onChange={(event) =>
                    setEmailForm((prev) => ({
                      ...prev,
                      subject: event.target.value,
                    }))
                  }
                  required
                />
              </label>
              <label>
                Mensaje
                <textarea
                  value={emailForm.message_body}
                  onChange={(event) =>
                    setEmailForm((prev) => ({
                      ...prev,
                      message_body: event.target.value,
                    }))
                  }
                  required
                />
              </label>
              <div className="proposal-document-modal-actions">
                <button
                  type="button"
                  onClick={() => setIsEmailModalOpen(false)}
                >
                  Cancelar
                </button>
                <button type="submit" disabled={isSendingEmail}>
                  {isSendingEmail ? "Enviando..." : "Enviar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
