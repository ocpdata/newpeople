import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, getApiErrorMessage } from "./api";
import QuotationStatusIcon from "./quotations/QuotationStatusIcon";
import { getQuotationStatusTone } from "./quotations/quotationStatusPresentation";

const ACCEPT_ORDER_STATUS_CODES = ["ganada", "aceptada"];

const WON_DOCUMENT_SOURCE_LABELS = {
  quotation: "Cotizacion",
  opportunity: "Oportunidad",
};

const PROCESSING_STAGE_DEFINITIONS = [
  { code: "quotation_accepted", name: "Cotizacion Aceptada" },
  { code: "kickoff_internal", name: "Kick Off interno" },
  { code: "kickoff_external", name: "Kick Off externo" },
  { code: "provider_purchase_order", name: "Orden de compra a proveedores" },
  { code: "products_reception", name: "Recepcion de productos" },
  { code: "preworks", name: "Preworks" },
  { code: "products_delivery", name: "Entrega de productos" },
  { code: "invoicing", name: "Facturacion" },
  { code: "collections", name: "Cobranza" },
  {
    code: "provider_invoice_reception",
    name: "Recepcion de factura del proveedor",
  },
  { code: "provider_payment", name: "Pago a proveedor" },
];

const PROCESSING_STAGE_STATUS_OPTIONS = [
  { value: "not_started", label: "No iniciada" },
  { value: "in_progress", label: "En progreso" },
  { value: "blocked", label: "Bloqueada" },
  { value: "completed", label: "Completada" },
  { value: "not_applicable", label: "No aplica" },
];

const PROCESSING_STAGE_STATUS_LABELS = Object.fromEntries(
  PROCESSING_STAGE_STATUS_OPTIONS.map((item) => [item.value, item.label]),
);

const BASE_STAGE_SPECIFIC_FIELDS = {
  provider_purchase_order: [
    { key: "poRequestedAt", label: "Fecha solicitud OC", type: "date" },
    { key: "poConfirmedAt", label: "Fecha confirmacion OC", type: "date" },
    {
      key: "providersInvolved",
      label: "Proveedores involucrados",
      type: "text",
      placeholder: "Ej. Provider A, Provider B",
    },
    {
      key: "purchaseOrderReferences",
      label: "Referencias OC",
      type: "text",
      placeholder: "Ej. OC-2025-004, OC-2025-009",
    },
  ],
  products_reception: [
    {
      key: "expectedReceptionDate",
      label: "Fecha esperada recepcion",
      type: "date",
    },
    { key: "actualReceptionDate", label: "Fecha real recepcion", type: "date" },
    {
      key: "receptionStatusDetail",
      label: "Detalle de recepcion",
      type: "text",
    },
    {
      key: "receivedItemsSummary",
      label: "Resumen items recibidos",
      type: "textarea",
    },
  ],
  preworks: [
    { key: "preworksOwner", label: "Responsable preworks", type: "text" },
    { key: "preworksStartDate", label: "Inicio preworks", type: "date" },
    { key: "preworksEndDate", label: "Fin preworks", type: "date" },
    { key: "preworksSummary", label: "Resumen preworks", type: "textarea" },
  ],
  products_delivery: [
    { key: "plannedDeliveryDate", label: "Entrega planificada", type: "date" },
    { key: "actualDeliveryDate", label: "Entrega real", type: "date" },
    {
      key: "deliveryEvidenceRefs",
      label: "Referencias evidencia entrega",
      type: "text",
    },
    {
      key: "deliveryObservations",
      label: "Observaciones de entrega",
      type: "textarea",
    },
  ],
  invoicing: [
    { key: "estimatedInvoiceDate", label: "Fecha estimada factura", type: "date" },
    { key: "actualInvoiceDate", label: "Fecha real factura", type: "date" },
    { key: "invoiceNumber", label: "Numero factura", type: "text" },
    { key: "invoiceAmount", label: "Monto factura", type: "text" },
  ],
  collections: [
    { key: "creditDays", label: "Dias de credito", type: "number" },
    {
      key: "expectedCollectionDate",
      label: "Fecha esperada cobranza",
      type: "date",
    },
    { key: "actualCollectionDate", label: "Fecha real cobranza", type: "date" },
    {
      key: "collectionStatusDetail",
      label: "Detalle estado cobranza",
      type: "textarea",
    },
  ],
  provider_invoice_reception: [
    { key: "providerInvoiceDate", label: "Fecha factura proveedor", type: "date" },
    {
      key: "providerInvoiceNumber",
      label: "Numero factura proveedor",
      type: "text",
    },
    {
      key: "providerInvoiceAmount",
      label: "Monto factura proveedor",
      type: "text",
    },
    {
      key: "providerInvoiceReceivedAt",
      label: "Fecha recepcion factura proveedor",
      type: "date",
    },
  ],
  provider_payment: [
    {
      key: "providerPaymentPlannedDate",
      label: "Fecha planificada pago proveedor",
      type: "date",
    },
    {
      key: "providerPaymentActualDate",
      label: "Fecha real pago proveedor",
      type: "date",
    },
    {
      key: "providerPaymentAmount",
      label: "Monto pago proveedor",
      type: "text",
    },
    {
      key: "providerPaymentReference",
      label: "Referencia pago proveedor",
      type: "text",
    },
  ],
};

function buildEmptyProcessingData() {
  return {
    quotation: null,
    stages: [],
    assignableUsers: [],
    kickoffInternal: {
      latestInvitation: null,
      invitations: [],
    },
    kickoffExternal: {
      evidences: [],
      aiSummaryCurrent: null,
      aiSummaryHistory: [],
    },
    permissions: {
      canRead: false,
      canUpdate: false,
      canGenerateIa: false,
      canConvoke: false,
    },
  };
}

function buildEmptyKickoffInvitationDraft() {
  return {
    meetingDate: "",
    meetingTime: "",
    meetingMode: "virtual",
    meetingLocation: "",
    meetingLink: "",
    inviteSubject: "",
    inviteBodyTemplate: "",
    internalAttendeesUserIds: [],
    externalAttendeesEmails: "",
  };
}

function buildKickoffInvitePrefill(quotation) {
  const opportunity = quotation?.opportunityName || "Oportunidad";
  const account = quotation?.accountName || "Cliente";
  const subject = `Kick Off interno - ${opportunity}`;
  const body = [
    `Hola equipo,`,
    "",
    `Se convoca Kick Off interno para la oportunidad ${opportunity} (${account}).`,
    "",
    "Fecha: [definir]",
    "Hora: [definir]",
    "Modalidad: [presencial/virtual]",
    "Ubicacion o link: [definir]",
    "",
    "Objetivo: alinear alcance operativo, tiempos y responsabilidades previas a la ejecucion.",
    "",
    "Gracias.",
  ].join("\n");

  return {
    ...buildEmptyKickoffInvitationDraft(),
    inviteSubject: subject,
    inviteBodyTemplate: body,
  };
}

function parseEmailDraft(value) {
  return Array.from(
    new Set(
      String(value || "")
        .split(/[\n,;]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function buildAcceptOrderWonDocumentsState() {
  return {
    loading: false,
    error: "",
    purchaseOrder: null,
    providerQuotes: [],
  };
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function formatCurrency(value, currencyCode = "USD") {
  return Number(value || 0).toLocaleString("en-US", {
    style: "currency",
    currency: currencyCode || "USD",
  });
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "-";
  return `${value.toFixed(1)}%`;
}

function calculateContributionPct(contribution, sale) {
  const saleAmount = Number(sale || 0);
  if (!saleAmount) return null;
  return (Number(contribution || 0) / saleAmount) * 100;
}

function getQuotationFinancials(quotation) {
  const totalSale = Number(quotation?.latestTotalSaleAmount || 0);
  const productSale = Number(quotation?.latestProductSaleAmount || 0);
  const serviceSale = Number(quotation?.latestServiceSaleAmount || 0);
  const productCost = Number(quotation?.latestProductCostAmount || 0);
  const serviceCost = Number(quotation?.latestServiceCostAmount || 0);
  const productContribution = Number(
    quotation?.latestProductContributionAmount || 0,
  );
  const serviceContribution = Number(
    quotation?.latestServiceContributionAmount || 0,
  );
  const totalCost = productCost + serviceCost;
  const totalContribution =
    quotation?.latestContributionAmount === null ||
    quotation?.latestContributionAmount === undefined
      ? productContribution + serviceContribution
      : Number(quotation.latestContributionAmount || 0);

  return {
    totalSale,
    totalCost,
    totalContribution,
    totalContributionPct: calculateContributionPct(
      totalContribution,
      totalSale,
    ),
    productSale,
    productCost,
    productContribution,
    productContributionPct: calculateContributionPct(
      productContribution,
      productSale,
    ),
    serviceSale,
    serviceCost,
    serviceContribution,
    serviceContributionPct: calculateContributionPct(
      serviceContribution,
      serviceSale,
    ),
  };
}

function isAcceptOrderQuotation(quotation) {
  return ACCEPT_ORDER_STATUS_CODES.includes(
    normalizeText(quotation?.latestStatusCode || quotation?.latestStatusName),
  );
}

function isAcceptedQuotation(quotation) {
  return (
    normalizeText(
      quotation?.latestStatusCode || quotation?.latestStatusName,
    ) === "aceptada"
  );
}

function isSellerNotificationPending(quotation) {
  return (
    normalizeText(quotation?.acceptanceNotificationStatusCode) === "pendiente"
  );
}

function getQuotationWorkflowBadgeClass(quotation) {
  return `user-status-badge ${getQuotationStatusTone({
    uiKey: quotation?.latestStatusUiKey,
    code: quotation?.latestStatusCode,
  })}`;
}

function getQuotationActivationBadgeClass(quotation) {
  const normalized = normalizeText(
    quotation?.activationStatusCode || quotation?.activationStatusName,
  );
  if (normalized === "activada") return "user-status-badge active";
  if (normalized === "pendiente_activacion" || normalized === "pendiente") {
    return "user-status-badge pending";
  }
  return "user-status-badge inactive";
}

function formatWonDocumentSourceLabel(source) {
  const normalizedSource = String(source || "").trim();
  return WON_DOCUMENT_SOURCE_LABELS[normalizedSource] || "Documento";
}

export default function AcceptOrderPage() {
  const navigate = useNavigate();
  const [quotations, setQuotations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [query, setQuery] = useState("");
  const [sortField, setSortField] = useState("id");
  const [sortDirection, setSortDirection] = useState("desc");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [openQuotationMenuId, setOpenQuotationMenuId] = useState(null);
  const [acceptingVersionId, setAcceptingVersionId] = useState(null);
  const [quotationToAccept, setQuotationToAccept] = useState(null);
  const [quotationToNotify, setQuotationToNotify] = useState(null);
  const [sellerNotificationNote, setSellerNotificationNote] = useState("");
  const [sendingNotificationQuotationId, setSendingNotificationQuotationId] =
    useState(null);
  const [acceptOrderWonDocuments, setAcceptOrderWonDocuments] = useState(() =>
    buildAcceptOrderWonDocumentsState(),
  );
  const [downloadingWonDocumentKey, setDownloadingWonDocumentKey] =
    useState("");
  const [quotationToProcess, setQuotationToProcess] = useState(null);
  const [processingData, setProcessingData] = useState(() =>
    buildEmptyProcessingData(),
  );
  const [processingLoading, setProcessingLoading] = useState(false);
  const [processingModalError, setProcessingModalError] = useState("");
  const [activeProcessingStageCode, setActiveProcessingStageCode] =
    useState("quotation_accepted");
  const [processingSavingStageCode, setProcessingSavingStageCode] =
    useState("");
  const [processingDirty, setProcessingDirty] = useState(false);
  const [kickoffInvitationModalOpen, setKickoffInvitationModalOpen] =
    useState(false);
  const [kickoffInvitationDraft, setKickoffInvitationDraft] = useState(() =>
    buildEmptyKickoffInvitationDraft(),
  );
  const [savingKickoffInvitation, setSavingKickoffInvitation] =
    useState(false);
  const [kickoffExternalManualNote, setKickoffExternalManualNote] =
    useState("");
  const [uploadingKickoffExternalEvidence, setUploadingKickoffExternalEvidence] =
    useState(false);
  const [savingKickoffExternalManualNote, setSavingKickoffExternalManualNote] =
    useState(false);
  const [generatingKickoffExternalAi, setGeneratingKickoffExternalAi] =
    useState(false);

  useEffect(() => {
    let ignore = false;

    async function loadQuotations() {
      setLoading(true);
      setError("");
      try {
        const { data } = await api.get(
          `/api/quotations?latestStatusCodes=${ACCEPT_ORDER_STATUS_CODES.join(",")}`,
        );
        if (!ignore) {
          setQuotations(
            Array.isArray(data) ? data.filter(isAcceptOrderQuotation) : [],
          );
        }
      } catch (loadError) {
        if (!ignore) {
          setError(
            getApiErrorMessage(
              loadError,
              "No fue posible cargar las cotizaciones para aceptar pedido",
            ),
          );
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    void loadQuotations();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    setPage(1);
  }, [query, perPage]);

  function toggleSort(field) {
    if (sortField === field) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortField(field);
    setSortDirection(field === "id" ? "desc" : "asc");
  }

  function getSortArrow(field) {
    if (sortField !== field) return "";
    return sortDirection === "asc" ? "↑" : "↓";
  }

  function toggleQuotationMenu(quotationId) {
    setOpenQuotationMenuId((current) =>
      current === quotationId ? null : quotationId,
    );
  }

  async function openAcceptQuotationModal(quotation) {
    if (
      isAcceptedQuotation(quotation) ||
      !Number(quotation?.latestVersionId || 0)
    ) {
      return;
    }

    const versionId = Number(quotation?.latestVersionId || 0);
    setOpenQuotationMenuId(null);
    setQuotationToAccept(quotation);
    setAcceptOrderWonDocuments({
      loading: true,
      error: "",
      purchaseOrder: null,
      providerQuotes: [],
    });
    setError("");
    setSuccess("");

    try {
      const { data } = await api.get(
        `/api/quotation-versions/${versionId}/won-documents`,
      );

      setAcceptOrderWonDocuments({
        loading: false,
        error: "",
        purchaseOrder: data?.savedSelections?.purchaseOrder || null,
        providerQuotes: Array.isArray(data?.savedSelections?.providerQuotes)
          ? data.savedSelections.providerQuotes
          : [],
      });
    } catch (loadError) {
      setAcceptOrderWonDocuments({
        loading: false,
        error: getApiErrorMessage(
          loadError,
          "No fue posible cargar los documentos de cierre registrados",
        ),
        purchaseOrder: null,
        providerQuotes: [],
      });
    }
  }

  function closeAcceptQuotationModal() {
    if (acceptingVersionId) return;
    setQuotationToAccept(null);
    setAcceptOrderWonDocuments(buildAcceptOrderWonDocumentsState());
    setDownloadingWonDocumentKey("");
  }

  async function handleDownloadWonDocument(documentItem) {
    const versionId = Number(quotationToAccept?.latestVersionId || 0);
    const source = String(documentItem?.source || "").trim();
    const documentId = Number(documentItem?.documentId || 0);
    if (!versionId || !source || !documentId) {
      return;
    }

    const downloadKey = `${source}:${documentId}`;
    try {
      setDownloadingWonDocumentKey(downloadKey);
      setError("");

      const response = await api.get(
        `/api/quotation-versions/${versionId}/won-documents/${encodeURIComponent(source)}/${documentId}/download`,
        { responseType: "blob" },
      );

      const blob = response?.data;
      const objectUrl = window.URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = objectUrl;
      link.download = documentItem?.originalFileName || "documento";
      window.document.body.appendChild(link);
      link.click();
      window.document.body.removeChild(link);
      window.URL.revokeObjectURL(objectUrl);
    } catch (downloadError) {
      setError(
        getApiErrorMessage(
          downloadError,
          "No fue posible descargar el documento de cierre",
        ),
      );
    } finally {
      setDownloadingWonDocumentKey("");
    }
  }

  function openSellerNotificationModal(quotation) {
    if (!quotation) return;
    setQuotationToNotify(quotation);
    setSellerNotificationNote("");
    setError("");
    setSuccess("");
  }

  function closeSellerNotificationModal() {
    if (sendingNotificationQuotationId) return;
    setQuotationToNotify(null);
    setSellerNotificationNote("");
  }

  function goToQuotation(quotation) {
    const quotationId = Number(quotation?.id || 0);
    if (!quotationId) return;
    navigate(`/quotations?quotationId=${quotationId}`);
  }

  async function acceptQuotation(quotation) {
    const versionId = Number(quotation?.latestVersionId || 0);
    if (!versionId || isAcceptedQuotation(quotation)) return;

    setAcceptingVersionId(versionId);
    setOpenQuotationMenuId(null);
    setError("");
    setSuccess("");
    try {
      const { data } = await api.post(
        `/api/quotation-versions/${versionId}/transition`,
        { actionCode: "aceptar" },
      );
      setQuotations((current) =>
        current.map((item) =>
          Number(item.latestVersionId || 0) === versionId
            ? {
                ...item,
                latestStatusCode: data?.statusCode || "aceptada",
                latestStatusName: data?.statusName || "Aceptada",
                latestStatusUiKey: "accepted",
              }
            : item,
        ),
      );
      setSuccess("Pedido aceptado");
      setQuotationToAccept(null);
    } catch (acceptError) {
      setError(
        getApiErrorMessage(acceptError, "No fue posible aceptar el pedido"),
      );
    } finally {
      setAcceptingVersionId(null);
    }
  }

  async function sendSellerNotification() {
    const quotationId = Number(quotationToNotify?.id || 0);
    const note = sellerNotificationNote.trim();
    if (!quotationId || !note) {
      setError("Escribe una nota para el vendedor");
      return;
    }

    setSendingNotificationQuotationId(quotationId);
    setError("");
    setSuccess("");
    try {
      const { data } = await api.post(
        `/api/quotations/${quotationId}/seller-notification`,
        { note },
      );
      const pendingPatch = {
        acceptanceNotificationStatusCode: data?.statusCode || "pendiente",
        acceptanceNotificationSentAt: data?.sentAt || new Date().toISOString(),
      };
      setQuotations((current) =>
        current.map((item) =>
          Number(item.id || 0) === quotationId
            ? { ...item, ...pendingPatch }
            : item,
        ),
      );
      setQuotationToAccept((current) =>
        Number(current?.id || 0) === quotationId
          ? { ...current, ...pendingPatch }
          : current,
      );
      setSuccess("Notificacion enviada al vendedor");
      closeSellerNotificationModal();
    } catch (notificationError) {
      setError(
        getApiErrorMessage(
          notificationError,
          "No fue posible enviar la notificacion al vendedor",
        ),
      );
    } finally {
      setSendingNotificationQuotationId(null);
    }
  }

  async function loadQuotationProcessing(quotation, preferredStageCode = "") {
    const quotationId = Number(quotation?.id || 0);
    if (!quotationId) return;

    setProcessingLoading(true);
    setProcessingModalError("");
    try {
      const { data } = await api.get(`/api/quotations/${quotationId}/processing`);
      setProcessingData(data || buildEmptyProcessingData());
      const availableStageCodes = Array.isArray(data?.stages)
        ? data.stages.map((item) => item?.stageCode).filter(Boolean)
        : [];
      const nextStageCode =
        preferredStageCode && availableStageCodes.includes(preferredStageCode)
          ? preferredStageCode
          : availableStageCodes[0] || "quotation_accepted";
      setActiveProcessingStageCode(nextStageCode);
      const latestInvitation = data?.kickoffInternal?.latestInvitation;
      if (latestInvitation) {
        setKickoffInvitationDraft({
          meetingDate: latestInvitation.meetingDate || "",
          meetingTime: latestInvitation.meetingTime || "",
          meetingMode: latestInvitation.meetingMode || "virtual",
          meetingLocation: latestInvitation.meetingLocation || "",
          meetingLink: latestInvitation.meetingLink || "",
          inviteSubject: latestInvitation.inviteSubject || "",
          inviteBodyTemplate: latestInvitation.inviteBodyTemplate || "",
          internalAttendeesUserIds: Array.isArray(
            latestInvitation.internalAttendeesUserIds,
          )
            ? latestInvitation.internalAttendeesUserIds
            : [],
          externalAttendeesEmails: Array.isArray(
            latestInvitation.externalAttendeesEmails,
          )
            ? latestInvitation.externalAttendeesEmails.join(", ")
            : "",
        });
      } else {
        setKickoffInvitationDraft(buildKickoffInvitePrefill(data?.quotation));
      }
      setProcessingDirty(false);
    } catch (processingError) {
      setProcessingModalError(
        getApiErrorMessage(
          processingError,
          "No fue posible cargar el flujo de procesamiento",
        ),
      );
      setProcessingData(buildEmptyProcessingData());
    } finally {
      setProcessingLoading(false);
    }
  }

  async function openProcessingModal(quotation) {
    if (!isAcceptedQuotation(quotation)) {
      return;
    }
    setOpenQuotationMenuId(null);
    setQuotationToProcess(quotation);
    setError("");
    setSuccess("");
    await loadQuotationProcessing(quotation);
  }

  function closeProcessingModal() {
    if (
      processingDirty &&
      !window.confirm("Hay cambios sin guardar en procesamiento. Deseas cerrar?")
    ) {
      return;
    }

    setQuotationToProcess(null);
    setProcessingData(buildEmptyProcessingData());
    setProcessingModalError("");
    setActiveProcessingStageCode("quotation_accepted");
    setProcessingSavingStageCode("");
    setProcessingDirty(false);
    setKickoffInvitationModalOpen(false);
    setKickoffExternalManualNote("");
  }

  function patchProcessingStage(stageCode, patch) {
    setProcessingData((current) => {
      const nextStages = (Array.isArray(current.stages) ? current.stages : []).map(
        (stage) => {
          if (stage.stageCode !== stageCode) return stage;
          return {
            ...stage,
            ...patch,
            stageData: {
              ...(stage.stageData || {}),
              ...(patch.stageData || {}),
            },
          };
        },
      );
      return {
        ...current,
        stages: nextStages,
      };
    });
    setProcessingDirty(true);
  }

  async function saveProcessingStage(stageCode) {
    const quotationId = Number(quotationToProcess?.id || 0);
    const stage = (processingData.stages || []).find(
      (item) => item.stageCode === stageCode,
    );
    if (!quotationId || !stage) return;

    setProcessingSavingStageCode(stageCode);
    setError("");
    setSuccess("");
    try {
      const payload = {
        status: stage.status || "not_started",
        ownerUserId: stage.ownerUserId || null,
        targetDate: stage.targetDate || null,
        completedAt: stage.completedAt || null,
        blockedReason: stage.blockedReason || null,
        notes: stage.notes || null,
        stageData: stage.stageData || {},
      };
      const { data } = await api.patch(
        `/api/quotations/${quotationId}/processing/stages/${encodeURIComponent(stageCode)}`,
        payload,
      );
      setProcessingData((current) => ({
        ...current,
        stages: Array.isArray(data?.stages) ? data.stages : current.stages,
      }));
      setSuccess(`Etapa ${stage.stageName || stageCode} guardada`);
      setProcessingDirty(false);
    } catch (saveError) {
      setError(
        getApiErrorMessage(saveError, "No fue posible guardar la etapa"),
      );
    } finally {
      setProcessingSavingStageCode("");
    }
  }

  async function saveKickoffInvitation(statusCode) {
    const quotationId = Number(quotationToProcess?.id || 0);
    if (!quotationId) return;

    setSavingKickoffInvitation(true);
    setError("");
    setSuccess("");
    try {
      const payload = {
        meetingDate: kickoffInvitationDraft.meetingDate || null,
        meetingTime: kickoffInvitationDraft.meetingTime || null,
        meetingMode: kickoffInvitationDraft.meetingMode || null,
        meetingLocation: kickoffInvitationDraft.meetingLocation || null,
        meetingLink: kickoffInvitationDraft.meetingLink || null,
        inviteSubject: kickoffInvitationDraft.inviteSubject,
        inviteBodyTemplate: kickoffInvitationDraft.inviteBodyTemplate,
        internalAttendeesUserIds: kickoffInvitationDraft.internalAttendeesUserIds,
        externalAttendeesEmails: parseEmailDraft(
          kickoffInvitationDraft.externalAttendeesEmails,
        ),
        statusCode,
      };
      await api.post(
        `/api/quotations/${quotationId}/processing/kickoff-internal/invitations`,
        payload,
      );
      await loadQuotationProcessing(quotationToProcess, "kickoff_internal");
      setKickoffInvitationModalOpen(false);
      setSuccess(
        statusCode === "sent"
          ? "Convocatoria interna enviada"
          : "Borrador de convocatoria guardado",
      );
    } catch (inviteError) {
      setError(
        getApiErrorMessage(
          inviteError,
          "No fue posible guardar la convocatoria interna",
        ),
      );
    } finally {
      setSavingKickoffInvitation(false);
    }
  }

  async function uploadKickoffExternalEvidence(files) {
    const quotationId = Number(quotationToProcess?.id || 0);
    if (!quotationId || !files?.length) return;

    setUploadingKickoffExternalEvidence(true);
    setError("");
    setSuccess("");
    try {
      const formData = new FormData();
      Array.from(files).forEach((file) => {
        formData.append("files", file);
      });
      await api.post(
        `/api/quotations/${quotationId}/processing/kickoff-external/evidences/files`,
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        },
      );
      await loadQuotationProcessing(quotationToProcess, "kickoff_external");
      setSuccess("Evidencias cargadas en Kick Off externo");
    } catch (uploadError) {
      setError(
        getApiErrorMessage(
          uploadError,
          "No fue posible cargar la evidencia en Kick Off externo",
        ),
      );
    } finally {
      setUploadingKickoffExternalEvidence(false);
    }
  }

  async function saveKickoffExternalManualEvidence() {
    const quotationId = Number(quotationToProcess?.id || 0);
    const contentText = kickoffExternalManualNote.trim();
    if (!quotationId || !contentText) {
      setError("Escribe la minuta o acuerdo antes de guardar la evidencia");
      return;
    }

    setSavingKickoffExternalManualNote(true);
    setError("");
    setSuccess("");
    try {
      await api.post(
        `/api/quotations/${quotationId}/processing/kickoff-external/evidences/manual-note`,
        { contentText },
      );
      setKickoffExternalManualNote("");
      await loadQuotationProcessing(quotationToProcess, "kickoff_external");
      setSuccess("Minuta del Kick Off externo registrada");
    } catch (manualEvidenceError) {
      setError(
        getApiErrorMessage(
          manualEvidenceError,
          "No fue posible registrar la minuta de Kick Off externo",
        ),
      );
    } finally {
      setSavingKickoffExternalManualNote(false);
    }
  }

  async function generateKickoffExternalAiSummary() {
    const quotationId = Number(quotationToProcess?.id || 0);
    if (!quotationId) return;

    setGeneratingKickoffExternalAi(true);
    setError("");
    setSuccess("");
    try {
      await api.post(
        `/api/quotations/${quotationId}/processing/kickoff-external/ai-summary`,
      );
      await loadQuotationProcessing(quotationToProcess, "kickoff_external");
      setSuccess("Resumen IA generado para Kick Off externo");
    } catch (aiError) {
      setError(
        getApiErrorMessage(aiError, "No fue posible generar el resumen IA"),
      );
    } finally {
      setGeneratingKickoffExternalAi(false);
    }
  }

  async function downloadKickoffEvidence(evidence) {
    const quotationId = Number(quotationToProcess?.id || 0);
    const evidenceId = Number(evidence?.id || 0);
    if (!quotationId || !evidenceId || !evidence?.document) return;

    try {
      setError("");
      const response = await api.get(
        `/api/quotations/${quotationId}/processing/evidences/${evidenceId}/download`,
        { responseType: "blob" },
      );
      const blob = response?.data;
      const objectUrl = window.URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = objectUrl;
      link.download = evidence.document.originalFileName || "evidencia";
      window.document.body.appendChild(link);
      link.click();
      window.document.body.removeChild(link);
      window.URL.revokeObjectURL(objectUrl);
    } catch (downloadError) {
      setError(
        getApiErrorMessage(downloadError, "No fue posible descargar la evidencia"),
      );
    }
  }

  function updateActiveStageCommonField(fieldName, value) {
    if (!activeProcessingStage) return;
    patchProcessingStage(activeProcessingStage.stageCode, {
      [fieldName]: value,
    });
  }

  function updateActiveStageDataField(fieldName, value) {
    if (!activeProcessingStage) return;
    patchProcessingStage(activeProcessingStage.stageCode, {
      stageData: {
        [fieldName]: value,
      },
    });
  }

  function renderStageBaseSpecificFields(stage) {
    const fieldList = BASE_STAGE_SPECIFIC_FIELDS[stage.stageCode] || [];
    if (!fieldList.length) return null;

    return (
      <section className="processing-stage-box">
        <header>
          <h5>Datos base de etapa</h5>
        </header>
        <div className="processing-stage-grid two">
          {fieldList.map((field) => {
            const value = stage?.stageData?.[field.key] ?? "";
            if (field.type === "textarea") {
              return (
                <label key={field.key} className="field-group processing-stage-field full">
                  <span>{field.label}</span>
                  <textarea
                    value={value}
                    onChange={(event) =>
                      updateActiveStageDataField(field.key, event.target.value)
                    }
                    rows={4}
                    placeholder={field.placeholder || ""}
                    disabled={!processingData.permissions?.canUpdate}
                  />
                </label>
              );
            }

            return (
              <label key={field.key} className="field-group processing-stage-field">
                <span>{field.label}</span>
                <input
                  type={field.type}
                  value={value}
                  placeholder={field.placeholder || ""}
                  onChange={(event) =>
                    updateActiveStageDataField(field.key, event.target.value)
                  }
                  disabled={!processingData.permissions?.canUpdate}
                />
              </label>
            );
          })}
        </div>
      </section>
    );
  }

  const visibleQuotations = useMemo(() => {
    const normalizedQuery = normalizeText(query);
    const searched = normalizedQuery
      ? quotations.filter((quotation) => {
          const haystack = [
            quotation.id,
            quotation.latestVersionNumber,
            quotation.accountName,
            quotation.opportunityName,
            quotation.latestProposalName,
            quotation.sellerUserName,
            quotation.opportunitySalesStageName,
            quotation.latestStatusName,
            quotation.activationStatusName,
          ]
            .filter(Boolean)
            .join(" ");
          return normalizeText(haystack).includes(normalizedQuery);
        })
      : quotations;

    const readValue = (quotation) => {
      if (sortField === "id") return Number(quotation.id || 0);
      if (sortField === "version") {
        return Number(quotation.latestVersionNumber || 0);
      }
      if (sortField === "importe") {
        return Number(quotation.latestTotalSaleAmount || 0);
      }
      if (sortField === "cierre") {
        return String(quotation.opportunityCloseDate || "");
      }
      if (sortField === "cuenta") return String(quotation.accountName || "");
      if (sortField === "oportunidad") {
        return String(quotation.opportunityName || "");
      }
      if (sortField === "vendedor") {
        return String(quotation.sellerUserName || "");
      }
      if (sortField === "estado_cotizacion") {
        return String(quotation.latestStatusName || "");
      }
      return String(
        quotation.latestProposalName || quotation.opportunityName || "",
      );
    };

    return [...searched].sort((left, right) => {
      const leftValue = readValue(left);
      const rightValue = readValue(right);
      const result =
        typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue - rightValue
          : String(leftValue).localeCompare(String(rightValue), "es", {
              numeric: true,
              sensitivity: "base",
            });
      return sortDirection === "asc" ? result : -result;
    });
  }, [quotations, query, sortDirection, sortField]);

  const totalPages = Math.max(1, Math.ceil(visibleQuotations.length / perPage));
  const currentPage = Math.min(page, totalPages);
  const pagedQuotations = visibleQuotations.slice(
    (currentPage - 1) * perPage,
    currentPage * perPage,
  );
  const acceptFinancials = quotationToAccept
    ? getQuotationFinancials(quotationToAccept)
    : null;
  const acceptCurrencyCode = quotationToAccept?.latestCurrencyCode || "USD";
  const processingStages = Array.isArray(processingData?.stages)
    ? processingData.stages
    : [];
  const activeProcessingStage =
    processingStages.find((stage) => stage.stageCode === activeProcessingStageCode) ||
    processingStages[0] ||
    null;
  const processingUsers = Array.isArray(processingData?.assignableUsers)
    ? processingData.assignableUsers
    : [];

  return (
    <section className="panel">
      <div className="roles-page-header">
        <div className="roles-page-header-left">
          <div className="module-title-with-icon">
            <h2>Aceptar Pedido</h2>
            <span
              className="module-title-icon module-title-icon-opportunities"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M7 3.75A2.75 2.75 0 0 0 4.25 6.5v11A2.75 2.75 0 0 0 7 20.25h10a2.75 2.75 0 0 0 2.75-2.75v-11A2.75 2.75 0 0 0 17 3.75zm0 1.5h10c.69 0 1.25.56 1.25 1.25v11c0 .69-.56 1.25-1.25 1.25H7c-.69 0-1.25-.56-1.25-1.25v-11c0-.69.56-1.25 1.25-1.25" />
                <path d="M16.03 9.53a.75.75 0 0 0-1.06-1.06l-4.22 4.22-1.72-1.72a.75.75 0 0 0-1.06 1.06l2.25 2.25c.3.3.77.3 1.06 0z" />
              </svg>
            </span>
          </div>
          <p>
            Lista las cotizaciones ganadas para aceptar el pedido antes de su
            ejecucion operativa.
          </p>
        </div>
      </div>

      <div className="roles-pills-bar accounts-pills-bar-row">
        <div
          className="accounts-status-pills"
          role="group"
          aria-label="Estados incluidos"
        >
          <span className="status-filter-pill status-filter-pill-won is-selected">
            <span className="status-filter-pill-dot" aria-hidden="true" />
            <span className="status-filter-pill-text">Ganadas / Aceptadas</span>
            <span className="status-filter-pill-count">
              {quotations.length}
            </span>
          </span>
        </div>
        <input
          className="accounts-search-inline"
          type="text"
          placeholder="Buscar por ID, cuenta, oportunidad, propuesta, vendedor o estado"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {error ? <div className="toast toast-error">{error}</div> : null}
      {success ? <div className="toast toast-success">{success}</div> : null}
      {loading ? <p className="field-hint">Cargando cotizaciones...</p> : null}

      <table>
        <thead>
          <tr>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleSort("id")}
              >
                ID <span>{getSortArrow("id")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleSort("version")}
              >
                Version <span>{getSortArrow("version")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleSort("cuenta")}
              >
                Cuenta <span>{getSortArrow("cuenta")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleSort("oportunidad")}
              >
                Oportunidad <span>{getSortArrow("oportunidad")}</span>
              </button>
            </th>
            <th>Propuesta</th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleSort("vendedor")}
              >
                Vendedor <span>{getSortArrow("vendedor")}</span>
              </button>
            </th>
            <th>Etapa oportunidad</th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleSort("importe")}
              >
                Importe <span>{getSortArrow("importe")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleSort("cierre")}
              >
                Cierre <span>{getSortArrow("cierre")}</span>
              </button>
            </th>
            <th>
              <button
                type="button"
                className="sort-header-btn"
                onClick={() => toggleSort("estado_cotizacion")}
              >
                Estado cotizacion{" "}
                <span>{getSortArrow("estado_cotizacion")}</span>
              </button>
            </th>
            <th>Estado</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {!loading && pagedQuotations.length > 0 ? (
            pagedQuotations.map((quotation) => (
              <tr key={quotation.id}>
                <td>{quotation.id}</td>
                <td>{quotation.latestVersionNumber || "-"}</td>
                <td>{quotation.accountName || "-"}</td>
                <td>{quotation.opportunityName || "-"}</td>
                <td>{quotation.latestProposalName || "-"}</td>
                <td>{quotation.sellerUserName || "-"}</td>
                <td>{quotation.opportunitySalesStageName || "-"}</td>
                <td>
                  {formatCurrency(
                    quotation.latestTotalSaleAmount,
                    quotation.latestCurrencyCode,
                  )}
                </td>
                <td>{formatDate(quotation.opportunityCloseDate)}</td>
                <td>
                  <span
                    className={`${getQuotationWorkflowBadgeClass(quotation)} quotation-status-badge`}
                  >
                    <span
                      className="quotation-status-badge-icon"
                      aria-hidden="true"
                    >
                      <QuotationStatusIcon
                        status={{
                          uiKey: quotation.latestStatusUiKey,
                          code: quotation.latestStatusCode,
                        }}
                      />
                    </span>
                    {quotation.latestStatusName || "-"}
                  </span>
                </td>
                <td>
                  <span className={getQuotationActivationBadgeClass(quotation)}>
                    {quotation.activationStatusName || "-"}
                  </span>
                  {isSellerNotificationPending(quotation) ? (
                    <span className="accept-order-pending-badge">
                      Pendiente
                    </span>
                  ) : null}
                </td>
                <td className="accounts-actions-cell">
                  <div className="user-kebab-wrap opportunities-kebab-wrap">
                    <button
                      type="button"
                      className="kebab-btn"
                      onClick={() => toggleQuotationMenu(quotation.id)}
                      aria-label="Abrir acciones"
                    >
                      ⋮
                    </button>
                    {openQuotationMenuId === quotation.id ? (
                      <div className="user-kebab-menu quotation-actions-menu">
                        <button
                          type="button"
                          disabled={
                            isAcceptedQuotation(quotation) ||
                            acceptingVersionId === quotation.latestVersionId ||
                            !Number(quotation.latestVersionId || 0)
                          }
                          onClick={() => {
                            void openAcceptQuotationModal(quotation);
                          }}
                        >
                          {acceptingVersionId === quotation.latestVersionId
                            ? "Aceptando..."
                            : "Aceptar"}
                        </button>
                        {isAcceptedQuotation(quotation) ? (
                          <button
                            type="button"
                            onClick={() => {
                              void openProcessingModal(quotation);
                            }}
                          >
                            Procesar
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={12} className="empty-state">
                {loading
                  ? "Cargando cotizaciones..."
                  : "No hay cotizaciones ganadas o aceptadas para mostrar"}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {visibleQuotations.length > 0 && (
        <div className="users-pagination">
          <div className="users-pagination-left">
            <span className="users-pagination-info">
              {(currentPage - 1) * perPage + 1}–
              {Math.min(currentPage * perPage, visibleQuotations.length)} de{" "}
              {visibleQuotations.length}
            </span>
          </div>
          <div className="users-pagination-center">
            <button
              type="button"
              className="users-page-btn"
              disabled={currentPage === 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              ‹
            </button>
            <span className="users-pagination-pages">
              {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              className="users-page-btn"
              disabled={currentPage === totalPages}
              onClick={() =>
                setPage((current) => Math.min(totalPages, current + 1))
              }
            >
              ›
            </button>
          </div>
          <div className="users-pagination-right">
            <span className="users-pagination-label">Por pagina:</span>
            {[10, 50, 100].map((pageSize) => (
              <button
                key={pageSize}
                type="button"
                className={`users-perpage-btn${perPage === pageSize ? " is-active" : ""}`}
                onClick={() => setPerPage(pageSize)}
              >
                {pageSize}
              </button>
            ))}
          </div>
        </div>
      )}

      {quotationToAccept ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="accept-order-modal-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeAcceptQuotationModal();
            }
          }}
        >
          <div className="modal-dialog modal-dialog-wide accept-order-modal">
            <div className="accept-order-modal-hero">
              <div>
                <span className="accept-order-modal-kicker">
                  Cotizacion #{quotationToAccept.id} · Version{" "}
                  {quotationToAccept.latestVersionNumber || "-"}
                </span>
                <h3 id="accept-order-modal-title">
                  {quotationToAccept.latestProposalName || "Aceptar pedido"}
                </h3>
                <p>{quotationToAccept.accountName || "Cuenta sin nombre"}</p>
              </div>
              <span
                className={`${getQuotationWorkflowBadgeClass(quotationToAccept)} quotation-status-badge`}
              >
                <span
                  className="quotation-status-badge-icon"
                  aria-hidden="true"
                >
                  <QuotationStatusIcon
                    status={{
                      uiKey: quotationToAccept.latestStatusUiKey,
                      code: quotationToAccept.latestStatusCode,
                    }}
                  />
                </span>
                {quotationToAccept.latestStatusName || "-"}
              </span>
            </div>

            <div className="accept-order-modal-summary">
              <div>
                <span>Oportunidad</span>
                <strong>{quotationToAccept.opportunityName || "-"}</strong>
              </div>
              <div>
                <span>Vendedor</span>
                <strong>{quotationToAccept.sellerUserName || "-"}</strong>
              </div>
              <div>
                <span>Cierre</span>
                <strong>
                  {formatDate(quotationToAccept.opportunityCloseDate)}
                </strong>
              </div>
            </div>

            <div className="accept-order-total-card">
              <div>
                <span>Importe total</span>
                <strong>
                  {formatCurrency(
                    acceptFinancials.totalSale,
                    acceptCurrencyCode,
                  )}
                </strong>
              </div>
              <div>
                <span>Costo total</span>
                <strong>
                  {formatCurrency(
                    acceptFinancials.totalCost,
                    acceptCurrencyCode,
                  )}
                </strong>
              </div>
              <div>
                <span>Contribucion total</span>
                <strong>
                  {formatCurrency(
                    acceptFinancials.totalContribution,
                    acceptCurrencyCode,
                  )}
                </strong>
                <small>
                  {formatPercent(acceptFinancials.totalContributionPct)}
                </small>
              </div>
            </div>

            <div className="accept-order-financial-grid">
              <div className="accept-order-financial-card">
                <div className="accept-order-financial-card-header">
                  <span>Productos</span>
                  <strong>
                    {formatPercent(acceptFinancials.productContributionPct)}
                  </strong>
                </div>
                <dl>
                  <div>
                    <dt>Venta</dt>
                    <dd>
                      {formatCurrency(
                        acceptFinancials.productSale,
                        acceptCurrencyCode,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Costo</dt>
                    <dd>
                      {formatCurrency(
                        acceptFinancials.productCost,
                        acceptCurrencyCode,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Contribucion</dt>
                    <dd>
                      {formatCurrency(
                        acceptFinancials.productContribution,
                        acceptCurrencyCode,
                      )}
                    </dd>
                  </div>
                </dl>
              </div>
              <div className="accept-order-financial-card">
                <div className="accept-order-financial-card-header">
                  <span>Servicios</span>
                  <strong>
                    {formatPercent(acceptFinancials.serviceContributionPct)}
                  </strong>
                </div>
                <dl>
                  <div>
                    <dt>Venta</dt>
                    <dd>
                      {formatCurrency(
                        acceptFinancials.serviceSale,
                        acceptCurrencyCode,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Costo</dt>
                    <dd>
                      {formatCurrency(
                        acceptFinancials.serviceCost,
                        acceptCurrencyCode,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Contribucion</dt>
                    <dd>
                      {formatCurrency(
                        acceptFinancials.serviceContribution,
                        acceptCurrencyCode,
                      )}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            <section className="accept-order-won-documents-card">
              <header className="accept-order-won-documents-header">
                <h4>Documentos de cierre registrados</h4>
                <p>
                  Archivos seleccionados al declarar la cotizacion como ganada.
                </p>
              </header>

              {acceptOrderWonDocuments.loading ? (
                <p className="field-hint">Cargando documentos de cierre...</p>
              ) : null}

              {!acceptOrderWonDocuments.loading && acceptOrderWonDocuments.error ? (
                <p className="field-hint opportunity-documents-preview-error">
                  {acceptOrderWonDocuments.error}
                </p>
              ) : null}

              {!acceptOrderWonDocuments.loading && !acceptOrderWonDocuments.error ? (
                <div className="accept-order-won-documents-grid">
                  <section className="accept-order-won-documents-section">
                    <h5>1) Orden de compra</h5>
                    {acceptOrderWonDocuments.purchaseOrder ? (
                      <article className="accept-order-won-document-item">
                        <div className="accept-order-won-document-item-main">
                          <strong>
                            {acceptOrderWonDocuments.purchaseOrder
                              .originalFileName || "Documento"}
                          </strong>
                          <span className="field-hint">
                            {formatWonDocumentSourceLabel(
                              acceptOrderWonDocuments.purchaseOrder.source,
                            )}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="btn-secondary accept-order-won-document-download-btn"
                          onClick={() => {
                            void handleDownloadWonDocument(
                              acceptOrderWonDocuments.purchaseOrder,
                            );
                          }}
                          disabled={
                            downloadingWonDocumentKey ===
                            `${acceptOrderWonDocuments.purchaseOrder.source}:${acceptOrderWonDocuments.purchaseOrder.documentId}`
                          }
                          title="Descargar documento"
                          aria-label="Descargar documento"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M12 3.75a.75.75 0 0 1 .75.75v8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 1 1 1.06-1.06l2.72 2.72V4.5a.75.75 0 0 1 .75-.75ZM5 18.25a.75.75 0 0 1 .75.75v.25a1 1 0 0 0 1 1h10.5a1 1 0 0 0 1-1V19a.75.75 0 0 1 1.5 0v.25a2.5 2.5 0 0 1-2.5 2.5H6.75a2.5 2.5 0 0 1-2.5-2.5V19a.75.75 0 0 1 .75-.75Z" />
                          </svg>
                        </button>
                      </article>
                    ) : (
                      <p className="field-hint">
                        No hay orden de compra registrada.
                      </p>
                    )}
                  </section>

                  <section className="accept-order-won-documents-section">
                    <h5>2) Cotizaciones de proveedores</h5>
                    {acceptOrderWonDocuments.providerQuotes.length ? (
                      <div className="accept-order-won-documents-list">
                        {acceptOrderWonDocuments.providerQuotes.map((item) => (
                          <article
                            key={`provider-quote-${item.source}-${item.documentId}`}
                            className="accept-order-won-document-item"
                          >
                            <div className="accept-order-won-document-item-main">
                              <strong>{item.originalFileName || "Documento"}</strong>
                              <span className="field-hint">
                                {formatWonDocumentSourceLabel(item.source)}
                              </span>
                            </div>
                            <button
                              type="button"
                              className="btn-secondary accept-order-won-document-download-btn"
                              onClick={() => {
                                void handleDownloadWonDocument(item);
                              }}
                              disabled={
                                downloadingWonDocumentKey ===
                                `${item.source}:${item.documentId}`
                              }
                              title="Descargar documento"
                              aria-label="Descargar documento"
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M12 3.75a.75.75 0 0 1 .75.75v8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 1 1 1.06-1.06l2.72 2.72V4.5a.75.75 0 0 1 .75-.75ZM5 18.25a.75.75 0 0 1 .75.75v.25a1 1 0 0 0 1 1h10.5a1 1 0 0 0 1-1V19a.75.75 0 0 1 1.5 0v.25a2.5 2.5 0 0 1-2.5 2.5H6.75a2.5 2.5 0 0 1-2.5-2.5V19a.75.75 0 0 1 .75-.75Z" />
                              </svg>
                            </button>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="field-hint">
                        No hay cotizaciones de proveedores registradas.
                      </p>
                    )}
                  </section>
                </div>
              ) : null}
            </section>

            <div className="accept-order-modal-actions">
              <button
                type="button"
                className="btn-secondary accept-order-go-button"
                onClick={() => goToQuotation(quotationToAccept)}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    fill="currentColor"
                    d="M5 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5a1 1 0 1 0-2 0v5H5V6h5a1 1 0 1 0 0-2zm9 0a1 1 0 1 0 0 2h2.59l-6.3 6.3a1 1 0 1 0 1.42 1.4l6.29-6.29V10a1 1 0 1 0 2 0V5a1 1 0 0 0-1-1z"
                  />
                </svg>
                Ir a la cotizacion
              </button>
              <button
                type="button"
                className="btn-secondary accept-order-icon-button accept-order-email-button"
                onClick={() => openSellerNotificationModal(quotationToAccept)}
                aria-label="Enviar correo al vendedor"
                title="Enviar correo al vendedor"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    fill="currentColor"
                    d="M4.5 6.5A2.5 2.5 0 0 1 7 4h10a2.5 2.5 0 0 1 2.5 2.5v11A2.5 2.5 0 0 1 17 20H7a2.5 2.5 0 0 1-2.5-2.5zm2.1-.5 5.4 4.05L17.4 6zm10.9 12a.5.5 0 0 0 .5-.5V7.25l-5.4 4.05a1 1 0 0 1-1.2 0L6 7.25V17.5a.5.5 0 0 0 .5.5z"
                  />
                </svg>
              </button>
              <button
                type="button"
                className="btn-secondary accept-order-icon-button"
                onClick={closeAcceptQuotationModal}
                disabled={Boolean(acceptingVersionId)}
                aria-label="Cancelar aceptacion"
                title="Cancelar"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    fill="currentColor"
                    d="M6.22 4.81a1 1 0 0 0-1.41 1.41L10.59 12l-5.78 5.78a1 1 0 1 0 1.41 1.41L12 13.41l5.78 5.78a1 1 0 0 0 1.41-1.41L13.41 12l5.78-5.78a1 1 0 0 0-1.41-1.41L12 10.59z"
                  />
                </svg>
              </button>
              <button
                type="button"
                className="btn-primary accept-order-icon-button accept-order-confirm-button"
                onClick={() => acceptQuotation(quotationToAccept)}
                disabled={
                  Boolean(acceptingVersionId) ||
                  isAcceptedQuotation(quotationToAccept)
                }
                aria-label="Confirmar aceptacion"
                title="Confirmar aceptacion"
              >
                {acceptingVersionId === quotationToAccept.latestVersionId ? (
                  "Aceptando..."
                ) : (
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      fill="currentColor"
                      d="M9.55 17.2 4.8 12.45a1 1 0 0 1 1.4-1.42l3.35 3.34 8.25-8.24a1 1 0 1 1 1.4 1.42z"
                    />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {quotationToProcess ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="processing-modal-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeProcessingModal();
            }
          }}
        >
          <div className="modal-dialog modal-dialog-wide processing-modal">
            <div className="processing-modal-hero">
              <div>
                <span className="processing-modal-kicker">
                  Cotizacion #{quotationToProcess.id} · Procesamiento operativo
                </span>
                <h3 id="processing-modal-title">
                  {processingData?.quotation?.proposalName || "Flujo de procesamiento"}
                </h3>
                <p>
                  {processingData?.quotation?.accountName || "Cuenta"} ·{" "}
                  {processingData?.quotation?.opportunityName || "Oportunidad"}
                </p>
              </div>
              <button
                type="button"
                className="btn-secondary accept-order-icon-button"
                onClick={closeProcessingModal}
                title="Cerrar procesamiento"
                aria-label="Cerrar procesamiento"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M6.22 4.81a1 1 0 0 0-1.41 1.41L10.59 12l-5.78 5.78a1 1 0 1 0 1.41 1.41L12 13.41l5.78 5.78a1 1 0 0 0 1.41-1.41L13.41 12l5.78-5.78a1 1 0 0 0-1.41-1.41L12 10.59z"
                  />
                </svg>
              </button>
            </div>

            <div className="processing-stage-flow" role="tablist" aria-label="Etapas">
              {PROCESSING_STAGE_DEFINITIONS.map((stageDef) => {
                const stage = processingStages.find(
                  (item) => item.stageCode === stageDef.code,
                );
                const isActive = activeProcessingStageCode === stageDef.code;
                const status = stage?.status || "not_started";
                return (
                  <button
                    key={stageDef.code}
                    type="button"
                    className={`processing-stage-pill${isActive ? " is-active" : ""}`}
                    onClick={() => setActiveProcessingStageCode(stageDef.code)}
                    role="tab"
                    aria-selected={isActive}
                  >
                    <span>{stageDef.name}</span>
                    <small>{PROCESSING_STAGE_STATUS_LABELS[status] || "No iniciada"}</small>
                  </button>
                );
              })}
            </div>

            {processingLoading ? (
              <p className="field-hint processing-inline-message">
                Cargando flujo de procesamiento...
              </p>
            ) : null}

            {!processingLoading && processingModalError ? (
              <p className="field-hint opportunity-documents-preview-error processing-inline-message">
                {processingModalError}
              </p>
            ) : null}

            {!processingLoading && !processingModalError && activeProcessingStage ? (
              <div className="processing-stage-content">
                <section className="processing-stage-box">
                  <header>
                    <h4>{activeProcessingStage.stageName}</h4>
                    <p>
                      Edita esta etapa de forma independiente. El flujo no requiere
                      secuencia estricta.
                    </p>
                  </header>

                  <div className="processing-stage-grid two">
                    <label className="field-group processing-stage-field">
                      <span>Estado</span>
                      <select
                        value={activeProcessingStage.status || "not_started"}
                        onChange={(event) =>
                          updateActiveStageCommonField("status", event.target.value)
                        }
                        disabled={!processingData.permissions?.canUpdate}
                      >
                        {PROCESSING_STAGE_STATUS_OPTIONS.map((statusOption) => (
                          <option key={statusOption.value} value={statusOption.value}>
                            {statusOption.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field-group processing-stage-field">
                      <span>Responsable</span>
                      <select
                        value={activeProcessingStage.ownerUserId || ""}
                        onChange={(event) =>
                          updateActiveStageCommonField(
                            "ownerUserId",
                            event.target.value
                              ? Number(event.target.value)
                              : null,
                          )
                        }
                        disabled={!processingData.permissions?.canUpdate}
                      >
                        <option value="">Sin responsable</option>
                        {processingUsers.map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.fullName}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field-group processing-stage-field">
                      <span>Fecha objetivo</span>
                      <input
                        type="date"
                        value={activeProcessingStage.targetDate || ""}
                        onChange={(event) =>
                          updateActiveStageCommonField(
                            "targetDate",
                            event.target.value || null,
                          )
                        }
                        disabled={!processingData.permissions?.canUpdate}
                      />
                    </label>

                    <label className="field-group processing-stage-field">
                      <span>Fecha completada</span>
                      <input
                        type="datetime-local"
                        value={
                          activeProcessingStage.completedAt
                            ? String(activeProcessingStage.completedAt).slice(0, 16)
                            : ""
                        }
                        onChange={(event) =>
                          updateActiveStageCommonField(
                            "completedAt",
                            event.target.value
                              ? new Date(event.target.value).toISOString()
                              : null,
                          )
                        }
                        disabled={!processingData.permissions?.canUpdate}
                      />
                    </label>

                    <label className="field-group processing-stage-field full">
                      <span>Razon de bloqueo</span>
                      <textarea
                        rows={3}
                        value={activeProcessingStage.blockedReason || ""}
                        onChange={(event) =>
                          updateActiveStageCommonField(
                            "blockedReason",
                            event.target.value,
                          )
                        }
                        disabled={!processingData.permissions?.canUpdate}
                      />
                    </label>

                    <label className="field-group processing-stage-field full">
                      <span>Notas</span>
                      <textarea
                        rows={4}
                        value={activeProcessingStage.notes || ""}
                        onChange={(event) =>
                          updateActiveStageCommonField("notes", event.target.value)
                        }
                        disabled={!processingData.permissions?.canUpdate}
                      />
                    </label>
                  </div>

                  <div className="processing-stage-actions">
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() =>
                        void saveProcessingStage(activeProcessingStage.stageCode)
                      }
                      disabled={
                        !processingData.permissions?.canUpdate ||
                        processingSavingStageCode === activeProcessingStage.stageCode
                      }
                    >
                      {processingSavingStageCode === activeProcessingStage.stageCode
                        ? "Guardando..."
                        : "Guardar etapa"}
                    </button>
                  </div>
                </section>

                {activeProcessingStage.stageCode === "kickoff_internal" ? (
                  <section className="processing-stage-box">
                    <header>
                      <h5>Convocatoria Kick Off interno</h5>
                      <p>
                        Convoca usuarios internos y correos externos con mensaje
                        prellenado.
                      </p>
                    </header>

                    <div className="processing-stage-actions split">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setKickoffInvitationModalOpen(true)}
                        disabled={!processingData.permissions?.canConvoke}
                      >
                        Convocar kick off interno
                      </button>
                      <span className="field-hint">
                        {processingData?.kickoffInternal?.latestInvitation?.statusCode ===
                        "sent"
                          ? "Ultima convocatoria enviada"
                          : "Sin convocatoria enviada"}
                      </span>
                    </div>

                    {Array.isArray(processingData?.kickoffInternal?.invitations) &&
                    processingData.kickoffInternal.invitations.length ? (
                      <div className="processing-stage-log-list">
                        {processingData.kickoffInternal.invitations
                          .slice(0, 5)
                          .map((invitation) => (
                            <article
                              key={invitation.id}
                              className="processing-stage-log-item"
                            >
                              <strong>{invitation.inviteSubject}</strong>
                              <span className="field-hint">
                                {invitation.statusCode === "sent"
                                  ? "Enviada"
                                  : "Borrador"}
                                {" · "}
                                {formatDate(invitation.createdAt)}
                              </span>
                            </article>
                          ))}
                      </div>
                    ) : (
                      <p className="field-hint">
                        Aun no se registra convocatoria de Kick Off interno.
                      </p>
                    )}
                  </section>
                ) : null}

                {activeProcessingStage.stageCode === "kickoff_external" ? (
                  <>
                    <section className="processing-stage-box">
                      <header>
                        <h5>Evidencias Kick Off externo</h5>
                        <p>
                          Adjunta archivos de texto/audio o registra minuta manual.
                        </p>
                      </header>

                      <div className="processing-stage-grid two">
                        <label className="field-group processing-stage-field full">
                          <span>Minuta / acuerdos manuales</span>
                          <textarea
                            rows={4}
                            value={kickoffExternalManualNote}
                            onChange={(event) =>
                              setKickoffExternalManualNote(event.target.value)
                            }
                            placeholder="Escribe acuerdos, riesgos y pendientes del kick off externo"
                          />
                        </label>
                      </div>

                      <div className="processing-stage-actions split">
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => void saveKickoffExternalManualEvidence()}
                          disabled={
                            !kickoffExternalManualNote.trim() ||
                            savingKickoffExternalManualNote
                          }
                        >
                          {savingKickoffExternalManualNote
                            ? "Guardando minuta..."
                            : "Guardar minuta"}
                        </button>

                        <label className="btn-secondary processing-upload-button">
                          {uploadingKickoffExternalEvidence
                            ? "Subiendo evidencia..."
                            : "Subir evidencia"}
                          <input
                            type="file"
                            multiple
                            onChange={(event) => {
                              const selectedFiles = event.target.files;
                              if (selectedFiles?.length) {
                                void uploadKickoffExternalEvidence(selectedFiles);
                              }
                              event.target.value = "";
                            }}
                            disabled={uploadingKickoffExternalEvidence}
                            hidden
                          />
                        </label>
                      </div>

                      {Array.isArray(processingData?.kickoffExternal?.evidences) &&
                      processingData.kickoffExternal.evidences.length ? (
                        <div className="processing-stage-log-list">
                          {processingData.kickoffExternal.evidences.map((evidence) => (
                            <article
                              key={evidence.id}
                              className="processing-stage-log-item"
                            >
                              <div>
                                <strong>
                                  {evidence.document?.originalFileName ||
                                    (evidence.evidenceType === "manual_note"
                                      ? "Minuta manual"
                                      : "Evidencia")}
                                </strong>
                                <span className="field-hint">
                                  {evidence.evidenceType} · {formatDate(evidence.createdAt)}
                                </span>
                              </div>
                              {evidence.document ? (
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  onClick={() => void downloadKickoffEvidence(evidence)}
                                >
                                  Descargar
                                </button>
                              ) : null}
                            </article>
                          ))}
                        </div>
                      ) : (
                        <p className="field-hint">
                          Aun no existen evidencias en Kick Off externo.
                        </p>
                      )}
                    </section>

                    <section className="processing-stage-box">
                      <header>
                        <h5>Resumen IA y validacion comercial</h5>
                        <p>
                          Genera resumen IA y captura validaciones para completar la etapa.
                        </p>
                      </header>

                      <div className="processing-stage-actions split">
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={() => void generateKickoffExternalAiSummary()}
                          disabled={
                            !processingData.permissions?.canGenerateIa ||
                            generatingKickoffExternalAi ||
                            !processingData?.kickoffExternal?.evidences?.length
                          }
                        >
                          {generatingKickoffExternalAi
                            ? "Generando resumen IA..."
                            : "Generar resumen IA"}
                        </button>
                      </div>

                      {processingData?.kickoffExternal?.aiSummaryCurrent?.summary ? (
                        <div className="processing-ai-summary-grid">
                          <article>
                            <h6>Resumen ejecutivo</h6>
                            <p>
                              {processingData.kickoffExternal.aiSummaryCurrent.summary
                                .summary || "-"}
                            </p>
                          </article>
                          <article>
                            <h6>Puntos de conflicto</h6>
                            <p>
                              {(
                                processingData.kickoffExternal.aiSummaryCurrent.summary
                                  .conflictPoints || []
                              ).join(" | ") || "-"}
                            </p>
                          </article>
                          <article>
                            <h6>Riesgos</h6>
                            <p>
                              {(
                                processingData.kickoffExternal.aiSummaryCurrent.summary
                                  .riskPoints || []
                              ).join(" | ") || "-"}
                            </p>
                          </article>
                          <article>
                            <h6>Puntos por aclarar</h6>
                            <p>
                              {(
                                processingData.kickoffExternal.aiSummaryCurrent.summary
                                  .clarificationPoints || []
                              ).join(" | ") || "-"}
                            </p>
                          </article>
                        </div>
                      ) : (
                        <p className="field-hint">Aun no se genero resumen IA.</p>
                      )}

                      <div className="processing-stage-grid two">
                        <label className="field-group processing-stage-field">
                          <span>Fecha estimada facturacion</span>
                          <input
                            type="date"
                            value={
                              activeProcessingStage.stageData?.estimatedInvoicingDate || ""
                            }
                            onChange={(event) =>
                              updateActiveStageDataField(
                                "estimatedInvoicingDate",
                                event.target.value,
                              )
                            }
                            disabled={!processingData.permissions?.canUpdate}
                          />
                        </label>
                        <label className="field-group processing-stage-field">
                          <span>Fecha estimada entrega productos</span>
                          <input
                            type="date"
                            value={
                              activeProcessingStage.stageData?.estimatedDeliveryDate || ""
                            }
                            onChange={(event) =>
                              updateActiveStageDataField(
                                "estimatedDeliveryDate",
                                event.target.value,
                              )
                            }
                            disabled={!processingData.permissions?.canUpdate}
                          />
                        </label>
                        <label className="field-group processing-stage-field">
                          <span>Dias de credito cobranza</span>
                          <input
                            type="number"
                            min={0}
                            value={
                              activeProcessingStage.stageData?.collectionsCreditDays || ""
                            }
                            onChange={(event) =>
                              updateActiveStageDataField(
                                "collectionsCreditDays",
                                event.target.value,
                              )
                            }
                            disabled={!processingData.permissions?.canUpdate}
                          />
                        </label>
                        <label className="field-group processing-stage-field">
                          <span>Responsable operativo</span>
                          <input
                            type="text"
                            value={activeProcessingStage.stageData?.operationalOwner || ""}
                            onChange={(event) =>
                              updateActiveStageDataField(
                                "operationalOwner",
                                event.target.value,
                              )
                            }
                            disabled={!processingData.permissions?.canUpdate}
                          />
                        </label>
                        <label className="field-group processing-stage-field full">
                          <span>Alcance operativo</span>
                          <textarea
                            rows={3}
                            value={activeProcessingStage.stageData?.operationalScope || ""}
                            onChange={(event) =>
                              updateActiveStageDataField(
                                "operationalScope",
                                event.target.value,
                              )
                            }
                            disabled={!processingData.permissions?.canUpdate}
                          />
                        </label>
                        <label className="field-group processing-stage-field full">
                          <span>Timeline operativo</span>
                          <textarea
                            rows={3}
                            value={
                              activeProcessingStage.stageData?.operationalTimeline || ""
                            }
                            onChange={(event) =>
                              updateActiveStageDataField(
                                "operationalTimeline",
                                event.target.value,
                              )
                            }
                            disabled={!processingData.permissions?.canUpdate}
                          />
                        </label>
                        <label className="field-group processing-stage-field full">
                          <span>Otros puntos relevantes</span>
                          <textarea
                            rows={3}
                            value={
                              activeProcessingStage.stageData?.relevantAdditionalPoints ||
                              ""
                            }
                            onChange={(event) =>
                              updateActiveStageDataField(
                                "relevantAdditionalPoints",
                                event.target.value,
                              )
                            }
                            disabled={!processingData.permissions?.canUpdate}
                          />
                        </label>
                      </div>
                    </section>
                  </>
                ) : null}

                {activeProcessingStage.stageCode !== "kickoff_external" &&
                activeProcessingStage.stageCode !== "kickoff_internal" ? (
                  renderStageBaseSpecificFields(activeProcessingStage)
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {kickoffInvitationModalOpen && quotationToProcess ? (
        <div
          className="modal-overlay modal-overlay-elevated"
          role="dialog"
          aria-modal="true"
          aria-labelledby="kickoff-internal-invite-title"
          onClick={(event) => {
            if (event.target === event.currentTarget && !savingKickoffInvitation) {
              setKickoffInvitationModalOpen(false);
            }
          }}
        >
          <div className="modal-dialog processing-invite-modal">
            <div className="accept-order-notification-header">
              <span>Kick Off interno</span>
              <h3 id="kickoff-internal-invite-title">Convocatoria interna</h3>
              <p>
                Define invitados, fecha y mensaje para la coordinacion vendedor -
                preventa.
              </p>
            </div>

            <div className="processing-stage-grid two">
              <label className="field-group processing-stage-field">
                <span>Fecha</span>
                <input
                  type="date"
                  value={kickoffInvitationDraft.meetingDate}
                  onChange={(event) =>
                    setKickoffInvitationDraft((current) => ({
                      ...current,
                      meetingDate: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="field-group processing-stage-field">
                <span>Hora</span>
                <input
                  type="time"
                  value={kickoffInvitationDraft.meetingTime}
                  onChange={(event) =>
                    setKickoffInvitationDraft((current) => ({
                      ...current,
                      meetingTime: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="field-group processing-stage-field">
                <span>Modalidad</span>
                <select
                  value={kickoffInvitationDraft.meetingMode || "virtual"}
                  onChange={(event) =>
                    setKickoffInvitationDraft((current) => ({
                      ...current,
                      meetingMode: event.target.value,
                    }))
                  }
                >
                  <option value="virtual">Virtual</option>
                  <option value="presencial">Presencial</option>
                </select>
              </label>
              <label className="field-group processing-stage-field">
                <span>Ubicacion (si presencial)</span>
                <input
                  type="text"
                  value={kickoffInvitationDraft.meetingLocation}
                  onChange={(event) =>
                    setKickoffInvitationDraft((current) => ({
                      ...current,
                      meetingLocation: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="field-group processing-stage-field full">
                <span>Link (si virtual)</span>
                <input
                  type="url"
                  value={kickoffInvitationDraft.meetingLink}
                  onChange={(event) =>
                    setKickoffInvitationDraft((current) => ({
                      ...current,
                      meetingLink: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="field-group processing-stage-field full">
                <span>Invitados internos</span>
                <select
                  multiple
                  value={kickoffInvitationDraft.internalAttendeesUserIds.map(String)}
                  onChange={(event) => {
                    const values = Array.from(event.target.selectedOptions).map(
                      (option) => Number(option.value),
                    );
                    setKickoffInvitationDraft((current) => ({
                      ...current,
                      internalAttendeesUserIds: values,
                    }));
                  }}
                  size={6}
                >
                  {processingUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.fullName} {user.email ? `(${user.email})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-group processing-stage-field full">
                <span>Correos externos</span>
                <textarea
                  rows={3}
                  value={kickoffInvitationDraft.externalAttendeesEmails}
                  onChange={(event) =>
                    setKickoffInvitationDraft((current) => ({
                      ...current,
                      externalAttendeesEmails: event.target.value,
                    }))
                  }
                  placeholder="correo1@empresa.com, correo2@empresa.com"
                />
              </label>
              <label className="field-group processing-stage-field full">
                <span>Asunto</span>
                <input
                  type="text"
                  value={kickoffInvitationDraft.inviteSubject}
                  onChange={(event) =>
                    setKickoffInvitationDraft((current) => ({
                      ...current,
                      inviteSubject: event.target.value,
                    }))
                  }
                  maxLength={240}
                />
              </label>
              <label className="field-group processing-stage-field full">
                <span>Mensaje</span>
                <textarea
                  rows={8}
                  value={kickoffInvitationDraft.inviteBodyTemplate}
                  onChange={(event) =>
                    setKickoffInvitationDraft((current) => ({
                      ...current,
                      inviteBodyTemplate: event.target.value,
                    }))
                  }
                />
              </label>
            </div>

            <div className="processing-stage-actions split">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void saveKickoffInvitation("draft")}
                disabled={savingKickoffInvitation}
              >
                {savingKickoffInvitation ? "Guardando..." : "Guardar borrador"}
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void saveKickoffInvitation("sent")}
                disabled={savingKickoffInvitation}
              >
                {savingKickoffInvitation ? "Enviando..." : "Enviar convocatoria"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {quotationToNotify ? (
        <div
          className="modal-overlay modal-overlay-elevated"
          role="dialog"
          aria-modal="true"
          aria-labelledby="accept-order-notification-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeSellerNotificationModal();
            }
          }}
        >
          <div className="modal-dialog accept-order-notification-modal">
            <div className="accept-order-notification-header">
              <span>Correo al vendedor</span>
              <h3 id="accept-order-notification-title">
                {quotationToNotify.sellerUserName || "Vendedor"}
              </h3>
              <p>
                Cotizacion #{quotationToNotify.id} ·{" "}
                {quotationToNotify.latestProposalName || "Sin propuesta"}
              </p>
            </div>

            <label className="field-group accept-order-note-field">
              <span>Nota</span>
              <textarea
                value={sellerNotificationNote}
                onChange={(event) =>
                  setSellerNotificationNote(event.target.value)
                }
                rows={5}
                maxLength={2000}
                placeholder="Escribe la indicacion para el vendedor"
              />
            </label>

            <div className="accept-order-notification-actions">
              <button
                type="button"
                className="btn-secondary accept-order-icon-button"
                onClick={closeSellerNotificationModal}
                disabled={Boolean(sendingNotificationQuotationId)}
                aria-label="Cancelar envio"
                title="Cancelar"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    fill="currentColor"
                    d="M6.22 4.81a1 1 0 0 0-1.41 1.41L10.59 12l-5.78 5.78a1 1 0 1 0 1.41 1.41L12 13.41l5.78 5.78a1 1 0 0 0 1.41-1.41L13.41 12l5.78-5.78a1 1 0 0 0-1.41-1.41L12 10.59z"
                  />
                </svg>
              </button>
              <button
                type="button"
                className="btn-primary accept-order-icon-button accept-order-confirm-button"
                onClick={sendSellerNotification}
                disabled={
                  Boolean(sendingNotificationQuotationId) ||
                  !sellerNotificationNote.trim()
                }
                aria-label="Confirmar envio"
                title="Confirmar envio"
              >
                {sendingNotificationQuotationId === quotationToNotify.id ? (
                  "Enviando..."
                ) : (
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      fill="currentColor"
                      d="M2.7 11.08a1 1 0 0 1 .55-.84l16.5-8a1 1 0 0 1 1.4 1.15l-4 17.5a1 1 0 0 1-1.72.43l-4.25-4.75-3.3 3.06a1 1 0 0 1-1.67-.68v-5.1L3.3 12a1 1 0 0 1-.6-.92m5.5 2.17v3.4l2.1-1.95a1 1 0 0 1 1.43.07l3.9 4.36L18.58 6.2z"
                    />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
