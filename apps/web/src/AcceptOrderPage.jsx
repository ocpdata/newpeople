import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import DatePicker from "react-datepicker";
import { es } from "date-fns/locale";
import { api, getApiErrorMessage } from "./api";
import { getTodayBusinessDate, toBusinessDateIso } from "./business-timezone";
import QuotationStatusIcon from "./quotations/QuotationStatusIcon";
import PurchaseOrderPrintPreviewModal from "./quotations/PurchaseOrderPrintPreviewModal";
import { buildPurchaseOrderPrintModel } from "./quotations/buildPurchaseOrderPrintModel";
import { getQuotationStatusTone } from "./quotations/quotationStatusPresentation";

const ACCEPT_ORDER_STATUS_CODES = ["ganada", "aceptada"];

const WON_DOCUMENT_SOURCE_LABELS = {
  quotation: "Cotizacion",
  opportunity: "Oportunidad",
};

const DEFAULT_PURCHASE_ORDER_NOTES = `Notas:
* Forma de Pago. Transferencia Bancaria
* Cualquier documento adicional enviarlo a nuestros correos: icruz@accessq.com.mx
*Envio de equipo físico en nuestras oficinas ubicadas en: Montecito 38 P7 OF 1, Col. Nápoles
Alcaldía. Benito Juarez, CP. 03810 CDMX, Mèxico.
En coordinación con Isaac Emmanuel Cruz
icruz@accessq.com.mx Cel. +52 55 1459 8758`;

const PROCESSING_STAGE_DEFINITIONS = [
  { code: "quotation_accepted", name: "Aceptar Cotización" },
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
  provider_purchase_order: [],
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
    {
      key: "estimatedInvoiceDate",
      label: "Fecha estimada factura",
      type: "date",
    },
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
    {
      key: "providerInvoiceDate",
      label: "Fecha factura proveedor",
      type: "date",
    },
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
    providers: [],
    kickoffInternal: {
      latestInvitation: null,
      invitations: [],
      evidences: [],
      aiSummaryCurrent: null,
      aiSummaryHistory: [],
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
    meetingDateOptionOne: "",
    meetingDateOptionTwo: "",
    meetingTimeOptionOne: "",
    meetingTimeOptionTwo: "",
    meetingMode: "virtual",
    meetingLocation: "",
    inviteSubject: "",
    inviteBodyTemplate: "",
    internalAttendeesUserIds: [],
    externalAttendeesEmails: "",
  };
}

function formatInvitationDateOption(dateText) {
  const normalized = String(dateText || "").trim();
  if (!normalized) return "[pendiente]";
  const parts = normalized.split("-");
  if (parts.length !== 3) return normalized;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function buildKickoffInvitePrefill(quotation) {
  const opportunity = quotation?.opportunityName || "Oportunidad";
  const subject = `Kick Off interno - ${opportunity}`;
  const body = [
    `Hola equipo,`,
    "",
    `Se convoca Kick Off interno para la oportunidad ${opportunity}.`,
    "",
    "Fecha opcion 1: [definir]",
    "Fecha opcion 2: [definir]",
    "Hora: [definir]",
    "Modalidad: [presencial/virtual]",
    "",
    "Por favor confirmar disponibilidad para cualquiera de las dos fechas propuestas.",
    "",
    "Gracias.",
  ].join("\n");

  return {
    ...buildEmptyKickoffInvitationDraft(),
    inviteSubject: subject,
    inviteBodyTemplate: body,
  };
}

function buildKickoffInternalEmailPreview({ quotation, draft }) {
  const opportunity =
    String(quotation?.opportunityName || "Oportunidad").trim() || "Oportunidad";
  const optionOne = formatInvitationDateOption(draft?.meetingDateOptionOne);
  const optionTwo = formatInvitationDateOption(draft?.meetingDateOptionTwo);
  const timeOptionOne =
    String(draft?.meetingTimeOptionOne || "").trim() || "[pendiente]";
  const timeOptionTwo =
    String(draft?.meetingTimeOptionTwo || "").trim() || "[pendiente]";
  const modeText =
    String(draft?.meetingMode || "virtual").trim() === "presencial"
      ? "Presencial"
      : "Virtual";
  const locationText =
    modeText === "Presencial"
      ? String(draft?.meetingLocation || "").trim() || "[pendiente]"
      : "Se compartira en la convocatoria interna";

  const sellerName = String(quotation?.sellerUserName || "").trim();
  const usersById = new Map(
    (Array.isArray(draft?.assignableUsers) ? draft.assignableUsers : []).map(
      (user) => [Number(user.id), String(user.fullName || "").trim()],
    ),
  );
  const selectedNames = (
    Array.isArray(draft?.internalAttendeesUserIds)
      ? draft.internalAttendeesUserIds
      : []
  )
    .map((id) => usersById.get(Number(id)) || "")
    .map((name) => String(name || "").trim())
    .filter(Boolean);
  const normalizedSeller = sellerName.toLowerCase();
  const sellerInSelection =
    selectedNames.find((name) => name.toLowerCase() === normalizedSeller) ||
    sellerName ||
    "No identificado";
  const preSalesInSelection =
    selectedNames.find((name) => name.toLowerCase() !== normalizedSeller) ||
    "No identificado";

  const subject = `Kick Off interno - ${opportunity}`;
  const body = [
    "Hola equipo,",
    "",
    `Se convoca reunion de Kick Off interno para la oportunidad ${opportunity}.`,
    "",
    `Fecha opcion 1: ${optionOne} ${timeOptionOne !== "[pendiente]" ? `a las ${timeOptionOne}` : ""}`,
    `Fecha opcion 2: ${optionTwo} ${timeOptionTwo !== "[pendiente]" ? `a las ${timeOptionTwo}` : ""}`,
    `Modalidad: ${modeText}`,
    `${modeText === "Presencial" ? "Ubicacion" : "Referencia"}: ${locationText}`,
    "",
    `Vendedor (convocados): ${sellerInSelection}`,
    `Preventa (convocados): ${preSalesInSelection}`,
    "",
    "Por favor confirmar su disponibilidad para asistir en cualquiera de las dos fechas propuestas.",
    "",
    "Gracias.",
  ].join("\n");

  return { subject, body };
}

function buildSellerNotificationPrefill(quotation) {
  const sellerName = String(quotation?.sellerUserName || "Vendedor").trim();
  const quotationId = Number(quotation?.id || 0);
  const proposalName =
    String(quotation?.latestProposalName || "Sin propuesta").trim() ||
    "Sin propuesta";
  const opportunityName =
    String(quotation?.opportunityName || "Sin oportunidad").trim() ||
    "Sin oportunidad";
  const accountName =
    String(quotation?.accountName || "Sin cuenta").trim() || "Sin cuenta";

  return [
    `Hola ${sellerName},`,
    "",
    `Por favor da seguimiento a la cotizacion #${quotationId || "-"}.`,
    `Propuesta: ${proposalName}.`,
    `Oportunidad: ${opportunityName}.`,
    `Cuenta: ${accountName}.`,
    "",
    "Accion solicitada: revisar el flujo de procesamiento operativo y confirmar la etapa Aceptar Cotizacion.",
    "",
    "Gracias.",
  ].join("\n");
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

function toDateInputValue(value) {
  if (!value) return "";
  return toBusinessDateIso(value);
}

function parseDateInputValue(value) {
  const [year, month, day] = String(value || "")
    .split("-")
    .map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 12);
}

function formatDatePickerValue(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "";
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function calculateRemainingDays(value) {
  const [year, month, day] = String(value || "")
    .split("-")
    .map(Number);
  if (!year || !month || !day) return 0;

  const [todayYear, todayMonth, todayDay] = getTodayBusinessDate()
    .split("-")
    .map(Number);
  const todayUtc = Date.UTC(todayYear, todayMonth - 1, todayDay);
  const targetUtc = Date.UTC(year, month - 1, day);
  return Math.round((targetUtc - todayUtc) / (24 * 60 * 60 * 1000));
}

function normalizePositiveNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
}

function buildPurchaseOrderLines({
  products = [],
  productAssignments = {},
  providers = [],
}) {
  const providersById = new Map(
    (Array.isArray(providers) ? providers : []).map((provider) => [
      Number(provider.id),
      String(provider.name || "").trim(),
    ]),
  );

  const normalizedProducts = Array.isArray(products) ? products : [];
  const normalizedAssignments =
    productAssignments && typeof productAssignments === "object"
      ? productAssignments
      : {};

  const selectedOnly = normalizedProducts.filter((product) => {
    const assignment =
      normalizedAssignments[
        String(product.assignmentKey || product.id || "")
      ] || {};
    return Boolean(assignment?.selected);
  });
  const source = selectedOnly.length ? selectedOnly : normalizedProducts;

  return source.map((product) => {
    const itemKey = String(product.assignmentKey || product.id || "");
    const assignment = normalizedAssignments[itemKey] || {};
    const selectionDate =
      toDateInputValue(assignment?.selectionDate) ||
      toDateInputValue(product.selectionDate) ||
      toDateInputValue(new Date());
    const quantity = normalizePositiveNumber(
      assignment?.quantity,
      normalizePositiveNumber(product.quantity, 0),
    );
    const unitCost = normalizePositiveNumber(
      assignment?.unitCostWithDiscount,
      normalizePositiveNumber(product.unitCostWithDiscount, 0),
    );
    const discountPct = Math.min(
      100,
      normalizePositiveNumber(assignment?.discountPct, 0),
    );
    const providerId =
      assignment?.providerId == null || assignment?.providerId === ""
        ? Number(product.providerId || 0) || null
        : Number(assignment.providerId || 0) || null;
    const providerName =
      (providerId ? providersById.get(Number(providerId)) : "") ||
      String(product.providerName || "").trim() ||
      "";

    return {
      lineId: itemKey || `${Math.random()}`,
      productId: Number(product.sourceProductId || product.id || 0) || null,
      code: String(product.code || "").trim() || "-",
      description:
        String(product.description || "").trim() || "Sin descripcion",
      quantity,
      unitCost,
      discountPct,
      selectionDate,
      providerId,
      providerName,
      currencyCode: String(product.currencyCode || "USD").trim() || "USD",
    };
  });
}

function buildProviderPurchaseOrderRows({
  products = [],
  productAssignmentDuplicates = {},
  productAssignmentExtras = {},
  productAssignments = {},
}) {
  const normalizedProducts = Array.isArray(products) ? products : [];
  const normalizedDuplicates =
    productAssignmentDuplicates &&
    typeof productAssignmentDuplicates === "object"
      ? productAssignmentDuplicates
      : {};
  const normalizedExtras =
    productAssignmentExtras && typeof productAssignmentExtras === "object"
      ? productAssignmentExtras
      : {};
  const normalizedAssignments =
    productAssignments && typeof productAssignments === "object"
      ? productAssignments
      : {};

  const productsById = new Map(
    normalizedProducts
      .map((product) => [Number(product.id || 0), product])
      .filter(([id]) => Number.isInteger(id) && id > 0),
  );

  const baseRows = normalizedProducts.map((product) => {
    const productId = Number(product.id || 0) || null;
    return {
      ...product,
      id: String(product.id || ""),
      assignmentKey: String(product.id || ""),
      sourceProductId: productId,
      isDuplicate: false,
    };
  });

  const duplicatesBySource = Object.entries(normalizedDuplicates).reduce(
    (map, [duplicateKey, duplicateMeta]) => {
      const sourceProductId = Number(duplicateMeta?.sourceProductId || 0);
      const sourceProduct = productsById.get(sourceProductId);
      if (!sourceProduct) return map;
      const duplicateRow = {
        ...sourceProduct,
        id: String(duplicateKey),
        assignmentKey: String(duplicateKey),
        sourceProductId,
        isDuplicate: true,
        createdAt: Number(duplicateMeta?.createdAt || 0),
      };
      const current = map.get(sourceProductId) || [];
      current.push(duplicateRow);
      map.set(sourceProductId, current);
      return map;
    },
    new Map(),
  );

  const groupedRows = [];
  const seenAssignmentKeys = new Set();

  baseRows.forEach((baseRow) => {
    const sourceProductId = Number(baseRow.sourceProductId || 0);
    groupedRows.push(baseRow);
    seenAssignmentKeys.add(String(baseRow.assignmentKey || baseRow.id || ""));

    const explicitDuplicates = (duplicatesBySource.get(sourceProductId) || [])
      .filter((duplicateRow) => {
        const duplicateAssignmentKey = String(
          duplicateRow.assignmentKey || duplicateRow.id || "",
        );
        if (seenAssignmentKeys.has(duplicateAssignmentKey)) {
          return false;
        }
        seenAssignmentKeys.add(duplicateAssignmentKey);
        return true;
      })
      .map((duplicateRow) => ({ ...duplicateRow }));
    groupedRows.push(...explicitDuplicates);

    if (sourceProductId > 0) {
      Object.entries(normalizedAssignments).forEach(
        ([assignmentKey, assignment]) => {
          const normalizedAssignmentKey = String(assignmentKey || "");
          if (!normalizedAssignmentKey || seenAssignmentKeys.has(normalizedAssignmentKey)) {
            return;
          }
          if (!Boolean(assignment?.selected)) {
            return;
          }
          const assignmentSourceProductId = Number(assignment?.sourceProductId || 0);
          if (assignmentSourceProductId !== sourceProductId) {
            return;
          }

          const duplicateRow = {
            ...baseRow,
            id: normalizedAssignmentKey,
            assignmentKey: normalizedAssignmentKey,
            sourceProductId,
            isDuplicate: true,
            createdAt: Number(assignment?.createdAt || 0) || Date.now(),
            quantity: normalizePositiveNumber(
              assignment?.quantity,
              normalizePositiveNumber(baseRow.quantity, 0),
            ),
            unitCostWithDiscount: normalizePositiveNumber(
              assignment?.unitCostWithDiscount,
              normalizePositiveNumber(baseRow.unitCostWithDiscount, 0),
            ),
            providerId:
              assignment?.providerId == null || assignment?.providerId === ""
                ? Number(baseRow.providerId || 0) || null
                : Number(assignment.providerId || 0) || null,
            providerName:
              String(
                assignment?.providerName ||
                  baseRow.providerName ||
                  "",
              ).trim() || "",
            selectionDate:
              toDateInputValue(assignment?.selectionDate) ||
              toDateInputValue(baseRow.selectionDate) ||
              toDateInputValue(new Date()),
          };

          groupedRows.push(duplicateRow);
          seenAssignmentKeys.add(normalizedAssignmentKey);
        },
      );
    }
  });

  const extraRows = Object.entries(normalizedExtras)
    .map(([extraKey, extraMeta]) => ({
      id: String(extraKey),
      assignmentKey: String(extraKey),
      sourceProductId: Number(extraMeta?.sourceProductId || 0) || null,
      isDuplicate: false,
      isCustom: true,
      code: String(extraMeta?.code || "").trim() || "ITEM-MANUAL",
      description:
        String(extraMeta?.description || "").trim() ||
        "Item agregado manualmente",
      providerId: Number(extraMeta?.providerId || 0) || null,
      providerName: "",
      quantity: normalizePositiveNumber(extraMeta?.quantity, 1),
      unitCostWithDiscount: normalizePositiveNumber(
        extraMeta?.unitCostWithDiscount,
        0,
      ),
      selectionDate:
        toDateInputValue(extraMeta?.selectionDate) ||
        toDateInputValue(new Date()),
      currencyCode: String(extraMeta?.currencyCode || "USD").trim() || "USD",
      createdAt: Number(extraMeta?.createdAt || 0),
    }))
    .sort((left, right) => left.createdAt - right.createdAt);

  return [...groupedRows, ...extraRows];
}

function hydrateAssignmentsFromGeneratedOrders({
  products = [],
  productAssignments = {},
  productAssignmentDuplicates = {},
  productAssignmentExtras = {},
  generatedPurchaseOrders = [],
}) {
  const hydratedAssignments = {
    ...(productAssignments && typeof productAssignments === "object"
      ? productAssignments
      : {}),
  };
  const hydratedDuplicates = {
    ...(productAssignmentDuplicates &&
    typeof productAssignmentDuplicates === "object"
      ? productAssignmentDuplicates
      : {}),
  };
  const hydratedExtras = {
    ...(productAssignmentExtras && typeof productAssignmentExtras === "object"
      ? productAssignmentExtras
      : {}),
  };

  const productById = new Map(
    (Array.isArray(products) ? products : [])
      .map((product) => [Number(product.id || 0), product])
      .filter(([id]) => Number.isInteger(id) && id > 0),
  );

  (Array.isArray(generatedPurchaseOrders) ? generatedPurchaseOrders : []).forEach(
    (order) => {
      const orderDate = toDateInputValue(order?.orderDate) || "";
      const providerId = Number(order?.providerId || 0) || null;
      const generatedAt = Number(new Date(order?.generatedAt || Date.now()));

      (Array.isArray(order?.lines) ? order.lines : []).forEach((line) => {
        const assignmentKey = String(line?.sourceAssignmentKey || "").trim();
        if (!assignmentKey) return;

        const productId = Number(line?.productId || 0) || null;
        const sourceProductId =
          productId && productById.has(productId)
            ? productId
            : Number(assignmentKey || 0) || null;

        const existingAssignment = hydratedAssignments[assignmentKey] || {};
        hydratedAssignments[assignmentKey] = {
          ...existingAssignment,
          selected:
            existingAssignment?.selected == null
              ? true
              : Boolean(existingAssignment.selected),
          providerId:
            existingAssignment?.providerId == null ||
            existingAssignment?.providerId === ""
              ? providerId
              : existingAssignment.providerId,
          quantity:
            existingAssignment?.quantity == null ||
            existingAssignment?.quantity === ""
              ? String(normalizePositiveNumber(line?.quantity, 0))
              : existingAssignment.quantity,
          unitCostWithDiscount:
            existingAssignment?.unitCostWithDiscount == null ||
            existingAssignment?.unitCostWithDiscount === ""
              ? String(normalizePositiveNumber(line?.unitCost, 0))
              : existingAssignment.unitCostWithDiscount,
          selectionDate:
            toDateInputValue(existingAssignment?.selectionDate) ||
            toDateInputValue(line?.selectionDate) ||
            orderDate ||
            toDateInputValue(new Date()),
          sourceProductId:
            Number(existingAssignment?.sourceProductId || 0) || sourceProductId,
          createdAt:
            Number(existingAssignment?.createdAt || 0) ||
            (Number.isFinite(generatedAt) ? generatedAt : Date.now()),
        };

        const isBaseAssignmentKey =
          sourceProductId != null && assignmentKey === String(sourceProductId);
        if (
          sourceProductId != null &&
          !isBaseAssignmentKey &&
          !hydratedDuplicates[assignmentKey] &&
          !hydratedExtras[assignmentKey]
        ) {
          hydratedDuplicates[assignmentKey] = {
            sourceProductId,
            createdAt: Number.isFinite(generatedAt) ? generatedAt : Date.now(),
          };
        }

        if (
          sourceProductId == null &&
          !hydratedExtras[assignmentKey] &&
          !hydratedDuplicates[assignmentKey]
        ) {
          hydratedExtras[assignmentKey] = {
            createdAt: Number.isFinite(generatedAt) ? generatedAt : Date.now(),
            code: String(line?.code || "").trim() || "ITEM-MANUAL",
            description:
              String(line?.description || "").trim() ||
              "Item agregado manualmente",
            providerId,
            quantity: normalizePositiveNumber(line?.quantity, 1),
            unitCostWithDiscount: normalizePositiveNumber(line?.unitCost, 0),
            selectionDate:
              toDateInputValue(line?.selectionDate) ||
              orderDate ||
              toDateInputValue(new Date()),
          };
        }
      });
    },
  );

  return {
    productAssignments: hydratedAssignments,
    productAssignmentDuplicates: hydratedDuplicates,
    productAssignmentExtras: hydratedExtras,
  };
}

function calculatePurchaseOrderLineAmount(line) {
  const quantity = normalizePositiveNumber(line?.quantity, 0);
  const unitCost = normalizePositiveNumber(line?.unitCost, 0);
  const discountPct = Math.min(
    100,
    normalizePositiveNumber(line?.discountPct, 0),
  );
  return quantity * unitCost * (1 - discountPct / 100);
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
  const normalizedValue = String(value).trim();
  const dateOnlyMatch = normalizedValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = dateOnlyMatch
    ? new Date(
        Number(dateOnlyMatch[1]),
        Number(dateOnlyMatch[2]) - 1,
        Number(dateOnlyMatch[3]),
      )
    : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatPurchaseOrderNumber(quotationId, orderSequence, orderDate) {
  const dateValue = String(orderDate || "").trim();
  const [year, month, day] = dateValue.split("-");
  if (!year || !month || !day) {
    return `OC-${Number(quotationId || 0)}-${Number(orderSequence || 1)}`;
  }

  const yearSuffix = String(year).slice(-2);
  return `OC-${Number(quotationId || 0)}-${Number(orderSequence || 1)}-${day}-${month}-${yearSuffix}`;
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
  const [processingWonDocuments, setProcessingWonDocuments] = useState(() =>
    buildAcceptOrderWonDocumentsState(),
  );
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
  const [savingKickoffInvitation, setSavingKickoffInvitation] = useState(false);
  const [kickoffExternalManualNote, setKickoffExternalManualNote] =
    useState("");
  const [
    uploadingKickoffExternalEvidence,
    setUploadingKickoffExternalEvidence,
  ] = useState(false);
  const [savingKickoffExternalManualNote, setSavingKickoffExternalManualNote] =
    useState(false);
  const [generatingKickoffExternalAi, setGeneratingKickoffExternalAi] =
    useState(false);
  const [
    uploadingKickoffInternalEvidence,
    setUploadingKickoffInternalEvidence,
  ] = useState(false);
  const [uploadingReceptionEvidence, setUploadingReceptionEvidence] =
    useState(false);
  const [generatingKickoffInternalAi, setGeneratingKickoffInternalAi] =
    useState(false);
  const [deletingProcessingEvidenceIds, setDeletingProcessingEvidenceIds] =
    useState(() => new Set());
  const [deletingPurchaseOrderIds, setDeletingPurchaseOrderIds] = useState(
    () => new Set(),
  );
  const [editingProductCell, setEditingProductCell] = useState(null);
  const [purchaseOrderModalOpen, setPurchaseOrderModalOpen] = useState(false);
  const [purchaseOrderDraft, setPurchaseOrderDraft] = useState(null);
  const [quotationDeliveryTimes, setQuotationDeliveryTimes] = useState([]);
  const [quotationPaymentTerms, setQuotationPaymentTerms] = useState([]);
  const [purchaseOrderFinalPreviewOpen, setPurchaseOrderFinalPreviewOpen] =
    useState(false);
  const [
    generatedPurchaseOrderPreviewModel,
    setGeneratedPurchaseOrderPreviewModel,
  ] = useState(null);
  const [
    purchaseOrderPendingGeneratedOrders,
    setPurchaseOrderPendingGeneratedOrders,
  ] = useState([]);
  const [customStepItemPicker, setCustomStepItemPicker] = useState({
    isOpen: false,
    stageCode: "",
    itemKey: "",
    providerId: "",
    priceListId: "",
    activeLists: [],
    unavailableListMessage: "",
    loadingLists: false,
    loading: false,
    error: "",
    query: "",
    results: [],
  });
  const processingStageContentRef = useRef(null);

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
    let ignore = false;

    async function loadQuotationCommercialCatalogs() {
      try {
        const [deliveryTimesResponse, paymentTermsResponse] = await Promise.all(
          [
            api.get("/api/catalogs/quotation-delivery-times"),
            api.get("/api/catalogs/quotation-payment-terms"),
          ],
        );
        if (!ignore) {
          setQuotationDeliveryTimes(
            Array.isArray(deliveryTimesResponse.data)
              ? deliveryTimesResponse.data
              : [],
          );
          setQuotationPaymentTerms(
            Array.isArray(paymentTermsResponse.data)
              ? paymentTermsResponse.data
              : [],
          );
        }
      } catch {
        if (!ignore) {
          setQuotationDeliveryTimes([]);
          setQuotationPaymentTerms([]);
        }
      }
    }

    void loadQuotationCommercialCatalogs();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!activeProcessingStageCode) return;
    processingStageContentRef.current?.scrollIntoView({
      block: "start",
      behavior: "smooth",
    });
  }, [activeProcessingStageCode]);

  useEffect(() => {
    setPage(1);
  }, [query, perPage]);

  useEffect(() => {
    if (!customStepItemPicker.isOpen) return undefined;

    if (!customStepItemPicker.providerId) {
      setCustomStepItemPicker((prev) => ({
        ...prev,
        activeLists: [],
        priceListId: "",
        loadingLists: false,
        unavailableListMessage: "",
        loading: false,
        error: "",
        results: [],
      }));
      return undefined;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      setCustomStepItemPicker((prev) => ({
        ...prev,
        loadingLists: true,
        error: "",
      }));

      try {
        const { data } = await api.get("/api/quotation-product-lists", {
          params: {
            providerId: customStepItemPicker.providerId,
          },
        });

        if (cancelled) return;
        const nextActiveLists = Array.isArray(data) ? data : [];
        setCustomStepItemPicker((prev) => ({
          ...prev,
          loadingLists: false,
          activeLists: nextActiveLists,
          unavailableListMessage: nextActiveLists.length
            ? ""
            : "El proveedor seleccionado no tiene una lista activa disponible.",
          priceListId: nextActiveLists.length
            ? String(nextActiveLists[0].id)
            : "",
          results: nextActiveLists.length ? prev.results : [],
        }));
      } catch (pickerError) {
        if (cancelled) return;
        setCustomStepItemPicker((prev) => ({
          ...prev,
          loadingLists: false,
          error: getApiErrorMessage(
            pickerError,
            "No fue posible cargar las listas activas del proveedor",
          ),
        }));
      }
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [customStepItemPicker.isOpen, customStepItemPicker.providerId]);

  useEffect(() => {
    if (!customStepItemPicker.isOpen) return undefined;

    if (!customStepItemPicker.providerId || !customStepItemPicker.priceListId) {
      setCustomStepItemPicker((prev) => ({
        ...prev,
        loading: false,
        results: [],
      }));
      return undefined;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      setCustomStepItemPicker((prev) => ({
        ...prev,
        loading: true,
        error: "",
      }));

      try {
        const { data } = await api.get("/api/quotation-products/search", {
          params: {
            providerId: customStepItemPicker.providerId,
            priceListId: customStepItemPicker.priceListId,
            q: customStepItemPicker.query,
            limit: 25,
          },
        });

        if (cancelled) return;
        setCustomStepItemPicker((prev) => ({
          ...prev,
          loading: false,
          results: Array.isArray(data) ? data : [],
        }));
      } catch (pickerError) {
        if (cancelled) return;
        setCustomStepItemPicker((prev) => ({
          ...prev,
          loading: false,
          error: getApiErrorMessage(
            pickerError,
            "No fue posible cargar los productos disponibles",
          ),
        }));
      }
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    customStepItemPicker.isOpen,
    customStepItemPicker.providerId,
    customStepItemPicker.priceListId,
    customStepItemPicker.query,
  ]);

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

  async function loadWonDocumentsForVersion(
    versionId,
    setState,
    fallbackMessage,
  ) {
    const safeVersionId = Number(versionId || 0);
    if (!safeVersionId) {
      setState(buildAcceptOrderWonDocumentsState());
      return;
    }

    setState({
      loading: true,
      error: "",
      purchaseOrder: null,
      providerQuotes: [],
    });

    try {
      const { data } = await api.get(
        `/api/quotation-versions/${safeVersionId}/won-documents`,
      );

      setState({
        loading: false,
        error: "",
        purchaseOrder: data?.savedSelections?.purchaseOrder || null,
        providerQuotes: Array.isArray(data?.savedSelections?.providerQuotes)
          ? data.savedSelections.providerQuotes
          : [],
      });
    } catch (loadError) {
      setState({
        loading: false,
        error: getApiErrorMessage(loadError, fallbackMessage),
        purchaseOrder: null,
        providerQuotes: [],
      });
    }
  }

  async function openAcceptQuotationModal(quotation) {
    if (
      isAcceptedQuotation(quotation) ||
      !Number(quotation?.latestVersionId || 0)
    ) {
      return;
    }

    const versionId = Number(quotation?.latestVersionId || 0);
    setQuotationToAccept(quotation);
    setError("");
    setSuccess("");
    await loadWonDocumentsForVersion(
      versionId,
      setAcceptOrderWonDocuments,
      "No fue posible cargar los documentos de cierre registrados",
    );
  }

  function closeAcceptQuotationModal() {
    if (acceptingVersionId) return;
    setQuotationToAccept(null);
    setAcceptOrderWonDocuments(buildAcceptOrderWonDocumentsState());
    setDownloadingWonDocumentKey("");
  }

  async function handleDownloadWonDocument(documentItem) {
    const versionId = Number(
      quotationToAccept?.latestVersionId ||
        quotationToProcess?.latestVersionId ||
        0,
    );
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
    setSellerNotificationNote(buildSellerNotificationPrefill(quotation));
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

  async function acceptQuotationFromProcessing(quotation) {
    const versionId = Number(quotation?.latestVersionId || 0);
    if (!versionId || isAcceptedQuotation(quotation)) return true;

    setAcceptingVersionId(versionId);
    setError("");
    setSuccess("");
    try {
      const { data } = await api.post(
        `/api/quotation-versions/${versionId}/transition`,
        { actionCode: "aceptar" },
      );
      const acceptedPatch = {
        latestStatusCode: data?.statusCode || "aceptada",
        latestStatusName: data?.statusName || "Aceptada",
        latestStatusUiKey: "accepted",
      };
      setQuotations((current) =>
        current.map((item) =>
          Number(item.latestVersionId || 0) === versionId
            ? { ...item, ...acceptedPatch }
            : item,
        ),
      );
      setQuotationToAccept((current) =>
        Number(current?.latestVersionId || 0) === versionId
          ? { ...current, ...acceptedPatch }
          : current,
      );
      setQuotationToProcess((current) =>
        Number(current?.latestVersionId || 0) === versionId
          ? { ...current, ...acceptedPatch }
          : current,
      );
      return true;
    } catch (acceptError) {
      setError(
        getApiErrorMessage(acceptError, "No fue posible aceptar el pedido"),
      );
      return false;
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
      const { data } = await api.get(
        `/api/quotations/${quotationId}/processing`,
      );
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
          ...buildEmptyKickoffInvitationDraft(),
          meetingDateOptionOne: latestInvitation.meetingDate || "",
          meetingTimeOptionOne: latestInvitation.meetingTime || "",
          meetingTimeOptionTwo: latestInvitation.meetingTime || "",
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
    setQuotationToProcess(quotation);
    setError("");
    setSuccess("");
    await Promise.all([
      loadQuotationProcessing(quotation),
      loadWonDocumentsForVersion(
        quotation?.latestVersionId,
        setProcessingWonDocuments,
        "No fue posible cargar los documentos de cierre registrados",
      ),
    ]);
  }

  function closeProcessingModal() {
    if (
      processingDirty &&
      !window.confirm(
        "Hay cambios sin guardar en procesamiento. Deseas cerrar?",
      )
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
    setProcessingWonDocuments(buildAcceptOrderWonDocumentsState());
    setDownloadingWonDocumentKey("");
    setGeneratedPurchaseOrderPreviewModel(null);
    closePurchaseOrderModal();
    closeCustomStepItemPicker();
  }

  function closePurchaseOrderModal() {
    setPurchaseOrderModalOpen(false);
    setPurchaseOrderDraft(null);
    setPurchaseOrderFinalPreviewOpen(false);
    setPurchaseOrderPendingGeneratedOrders([]);
  }

  function openCustomStepItemPicker(stageCode, itemKey, providerId = "") {
    setCustomStepItemPicker({
      isOpen: true,
      stageCode: String(stageCode || ""),
      itemKey: String(itemKey || ""),
      providerId: providerId ? String(providerId) : "",
      priceListId: "",
      activeLists: [],
      unavailableListMessage: "",
      loadingLists: false,
      loading: false,
      error: "",
      query: "",
      results: [],
    });
  }

  function closeCustomStepItemPicker() {
    setCustomStepItemPicker({
      isOpen: false,
      stageCode: "",
      itemKey: "",
      providerId: "",
      priceListId: "",
      activeLists: [],
      unavailableListMessage: "",
      loadingLists: false,
      loading: false,
      error: "",
      query: "",
      results: [],
    });
  }

  function applyCatalogProductToCustomStepItem(product) {
    const stageCode = String(customStepItemPicker.stageCode || "");
    const itemKey = String(customStepItemPicker.itemKey || "");
    if (!stageCode || !itemKey || !product) return;

    const providerId = Number(product.providerId || 0) || null;
    const unitCost = normalizePositiveNumber(
      product.unitCostWithDiscount,
      normalizePositiveNumber(product.price, 0),
    );
    const normalizedCode = String(product.code || "").trim() || "ITEM-MANUAL";
    const normalizedDescription =
      String(product.description || "").trim() || "Item agregado manualmente";
    const normalizedCurrency =
      String(product.currencyCode || processingCurrencyCode || "USD").trim() ||
      "USD";

    setProcessingData((current) => {
      const nextStages = (
        Array.isArray(current.stages) ? current.stages : []
      ).map((stage) => {
        if (stage.stageCode !== stageCode) return stage;
        const stageData = stage.stageData || {};
        const currentAssignments =
          stageData.productAssignments &&
          typeof stageData.productAssignments === "object"
            ? stageData.productAssignments
            : {};
        const currentExtras =
          stageData.productAssignmentExtras &&
          typeof stageData.productAssignmentExtras === "object"
            ? stageData.productAssignmentExtras
            : {};
        const previousAssignment = currentAssignments[itemKey] || {};
        const previousExtra = currentExtras[itemKey] || {};

        return {
          ...stage,
          stageData: {
            ...stageData,
            productAssignments: {
              ...currentAssignments,
              [itemKey]: {
                ...previousAssignment,
                selected: true,
                providerId,
                unitCostWithDiscount: String(unitCost),
              },
            },
            productAssignmentExtras: {
              ...currentExtras,
              [itemKey]: {
                ...previousExtra,
                sourceProductId: Number(product.id || 0) || null,
                providerId,
                code: normalizedCode,
                description: normalizedDescription,
                currencyCode: normalizedCurrency,
                unitCostWithDiscount: unitCost,
              },
            },
          },
        };
      });
      return {
        ...current,
        stages: nextStages,
      };
    });
    setProcessingDirty(true);
    closeCustomStepItemPicker();
  }

  function openPurchaseOrderModal({
    stage,
    productAssignments,
    productAssignmentDuplicates,
    productAssignmentExtras,
    excludedAssignmentKeys = new Set(),
  }) {
    const selectedProductIds = new Set(
      Object.entries(
        productAssignments && typeof productAssignments === "object"
          ? productAssignments
          : {},
      )
        .filter(([, value]) => Boolean(value?.selected))
        .map(([key]) => String(key)),
    );

    if (!selectedProductIds.size) {
      setError("Selecciona al menos un item para generar orden.");
      return;
    }

    const providerPurchaseOrderRows = buildProviderPurchaseOrderRows({
      products: processingQuotationProducts,
      productAssignments,
      productAssignmentDuplicates,
      productAssignmentExtras,
    });

    const candidateLines = buildPurchaseOrderLines({
      products: providerPurchaseOrderRows,
      productAssignments,
      providers: processingProviders,
    });
    const selectedLines = candidateLines.filter(
      (line) =>
        selectedProductIds.has(String(line.lineId || "")) &&
        !excludedAssignmentKeys.has(String(line.lineId || "")),
    );

    if (!selectedLines.length) {
      setError("Selecciona al menos un item disponible para generar orden.");
      return;
    }

    const missingProviderLine = selectedLines.find(
      (line) => !Number(line?.providerId || 0),
    );
    if (missingProviderLine) {
      setError(
        `Selecciona proveedor para el item ${missingProviderLine.code || "sin codigo"}.`,
      );
      return;
    }

    const selectedProviderIds = new Set(
      selectedLines.map((line) => Number(line.providerId)),
    );
    if (selectedProviderIds.size > 1) {
      setError(
        "Selecciona items de un solo proveedor para generar la vista previa.",
      );
      return;
    }
    const selectedOrderDates = Array.from(
      new Set(
        selectedLines
          .map((line) => toDateInputValue(line.selectionDate))
          .filter(Boolean),
      ),
    );
    if (selectedOrderDates.length !== 1) {
      setError(
        "Los items seleccionados deben tener la misma fecha para generar la orden.",
      );
      return;
    }
    setError("");

    const orderDate = selectedOrderDates[0];
    const quotationNumber = Number(quotationToProcess?.id || 0);
    const firstOrderSequence =
      (Array.isArray(stage?.stageData?.generatedPurchaseOrders)
        ? stage.stageData.generatedPurchaseOrders.length
        : 0) + 1;
    const deliveryTimeCode = String(
      quotationToProcess?.latestDeliveryTime || "",
    );
    const deliveryTimeName =
      quotationDeliveryTimes.find(
        (option) => String(option.code || "") === deliveryTimeCode,
      )?.name || deliveryTimeCode;
    const paymentTermsCode = String(
      quotationToProcess?.latestPaymentTerms || "",
    );
    const paymentTermsName =
      quotationPaymentTerms.find(
        (option) => String(option.code || "") === paymentTermsCode,
      )?.name || paymentTermsCode;
    const groupedByProvider = selectedLines.reduce((map, line) => {
      const providerId = Number(line.providerId || 0);
      const current = map.get(providerId) || {
        draftId: `provider-${providerId}`,
        providerId,
        providerName: line.providerName || `Proveedor #${providerId}`,
        orderNumber: formatPurchaseOrderNumber(
          quotationNumber,
          firstOrderSequence + map.size,
          orderDate,
        ),
        orderDate,
        lines: [],
      };
      current.lines.push({
        ...line,
        selectionDate: toDateInputValue(line.selectionDate) || orderDate,
      });
      map.set(providerId, current);
      return map;
    }, new Map());

    const draft = {
      providerId: Number(selectedLines[0]?.providerId || 0),
      providerName: selectedLines[0]?.providerName || "Proveedor",
      providerContacts:
        processingProviders.find(
          (provider) =>
            Number(provider.id) === Number(selectedLines[0]?.providerId || 0),
        )?.contacts || [],
      providerContactId: Number(stage?.stageData?.providerContactId || 0) || "",
      finalCustomerName: quotationToProcess?.accountName || "",
      providerQuotation: stage?.stageData?.providerQuotation || "",
      paymentConditions:
        stage?.stageData?.purchaseOrderPaymentConditions ?? paymentTermsName,
      deliveryTime: deliveryTimeName,
      currencyCode: processingCurrencyCode || "USD",
      notes:
        stage?.stageData?.purchaseOrderNotes ?? DEFAULT_PURCHASE_ORDER_NOTES,
      orders: Array.from(groupedByProvider.values()),
    };

    setPurchaseOrderDraft(draft);
    setPurchaseOrderModalOpen(true);
  }

  function updatePurchaseOrderDraftOrderField(orderDraftId, field, value) {
    setPurchaseOrderDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        orders: (Array.isArray(current.orders) ? current.orders : []).map(
          (order) =>
            String(order.draftId) === String(orderDraftId)
              ? {
                  ...order,
                  [field]: value,
                }
              : order,
        ),
      };
    });
  }

  function updatePurchaseOrderDraftLine(orderDraftId, lineId, patch) {
    setPurchaseOrderDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        orders: (Array.isArray(current.orders) ? current.orders : []).map(
          (order) => {
            if (String(order.draftId) !== String(orderDraftId)) return order;
            return {
              ...order,
              lines: (Array.isArray(order.lines) ? order.lines : []).map(
                (line) =>
                  String(line.lineId) === String(lineId)
                    ? {
                        ...line,
                        ...patch,
                      }
                    : line,
              ),
            };
          },
        ),
      };
    });
  }

  function buildGeneratedPurchaseOrdersFromDraft() {
    if (!purchaseOrderDraft) {
      return { orders: [], errorMessage: "No hay ordenes para generar." };
    }

    const orders = Array.isArray(purchaseOrderDraft.orders)
      ? purchaseOrderDraft.orders
      : [];
    if (!orders.length) {
      return { orders: [], errorMessage: "No hay ordenes para generar." };
    }

    const invalidLine = orders
      .flatMap((order) =>
        (Array.isArray(order.lines) ? order.lines : []).map((line) => ({
          order,
          line,
        })),
      )
      .find(({ line }) => normalizePositiveNumber(line?.quantity, 0) <= 0);
    if (invalidLine) {
      return {
        orders: [],
        errorMessage: `La cantidad debe ser mayor a 0 para el item ${invalidLine.line.code || "sin codigo"}.`,
      };
    }

    const generatedOrders = orders.map((order, index) => ({
      orderId: `po-${Date.now()}-${index + 1}`,
      providerId: Number(order.providerId || 0),
      providerName: String(order.providerName || "").trim() || "Proveedor",
      orderNumber:
        String(order.orderNumber || "").trim() ||
        formatPurchaseOrderNumber(
          quotationToProcess?.id,
          index + 1,
          order.orderDate || purchaseOrderDraft.orders?.[index]?.orderDate,
        ),
      orderDate: order.orderDate || toDateInputValue(new Date()),
      currencyCode:
        purchaseOrderDraft.currencyCode || processingCurrencyCode || "USD",
      ivaPct: normalizePositiveNumber(order.ivaPct, 16),
      generatedAt: new Date().toISOString(),
      lines: (Array.isArray(order.lines) ? order.lines : []).map((line) => ({
        sourceAssignmentKey:
          String(line.lineId || line.sourceAssignmentKey || "").trim() || null,
        productId: Number(line.productId || 0) || null,
        code: line.code || "-",
        description: String(line.description || "").trim() || "Sin descripcion",
        quantity: normalizePositiveNumber(line.quantity, 0),
        unitCost: normalizePositiveNumber(line.unitCost, 0),
        discountPct: Math.min(
          100,
          normalizePositiveNumber(line.discountPct, 0),
        ),
        selectionDate: line.selectionDate || toDateInputValue(new Date()),
        amount: calculatePurchaseOrderLineAmount(line),
      })),
    }));

    return { orders: generatedOrders, errorMessage: "" };
  }

  function openPurchaseOrderFinalPreview() {
    const { orders, errorMessage } = buildGeneratedPurchaseOrdersFromDraft();
    if (errorMessage) {
      setError(errorMessage);
      return;
    }
    setError("");
    setPurchaseOrderPendingGeneratedOrders(orders);
    setPurchaseOrderFinalPreviewOpen(true);
  }

  async function confirmGeneratePurchaseOrdersFromPreview() {
    const generatedOrders = Array.isArray(purchaseOrderPendingGeneratedOrders)
      ? purchaseOrderPendingGeneratedOrders
      : [];
    if (!generatedOrders.length) {
      setError("No hay ordenes para generar.");
      return;
    }

    const quotationId = Number(quotationToProcess?.id || 0);
    if (!quotationId) return;

    setError("");
    try {
      const { data } = await api.post(
        `/api/quotations/${quotationId}/processing/provider-purchase-orders`,
        {
          orders: generatedOrders,
        },
      );
      if (Array.isArray(data?.stages)) {
        setProcessingData((current) => ({
          ...current,
          stages: data.stages,
        }));
      }
      setSuccess(`Se generaron ${generatedOrders.length} orden(es) de compra.`);
      closePurchaseOrderModal();
    } catch (generationError) {
      setError(
        getApiErrorMessage(
          generationError,
          "No fue posible guardar las ordenes de compra",
        ),
      );
    }
  }

  async function deleteGeneratedPurchaseOrder(order) {
    const quotationId = Number(quotationToProcess?.id || 0);
    const orderId = Number(order?.orderId || 0);
    if (!quotationId || !orderId) return;

    const orderLabel = order?.orderNumber || `Orden #${orderId}`;
    const shouldDelete = window.confirm(
      `Se eliminara "${orderLabel}". Esta accion no se puede deshacer.`,
    );
    if (!shouldDelete) return;

    setDeletingPurchaseOrderIds((current) => {
      const next = new Set(current);
      next.add(orderId);
      return next;
    });
    setError("");
    setSuccess("");
    try {
      const { data } = await api.delete(
        `/api/quotations/${quotationId}/processing/provider-purchase-orders/${orderId}`,
      );
      const generatedPurchaseOrders = Array.isArray(
        data?.generatedPurchaseOrders,
      )
        ? data.generatedPurchaseOrders
        : [];
      setProcessingData((current) => ({
        ...current,
        stages: current.stages.map((stage) =>
          stage.stageCode === "provider_purchase_order"
            ? {
                ...stage,
                stageData: {
                  ...(stage.stageData || {}),
                  generatedPurchaseOrders,
                },
              }
            : stage,
        ),
      }));
      setSuccess("Orden de compra eliminada");
    } catch (deleteError) {
      setError(
        getApiErrorMessage(
          deleteError,
          "No fue posible eliminar la orden de compra",
        ),
      );
    } finally {
      setDeletingPurchaseOrderIds((current) => {
        const next = new Set(current);
        next.delete(orderId);
        return next;
      });
    }
  }

  function openGeneratedPurchaseOrderPreview(order, stage) {
    const providers = Array.isArray(processingData?.providers)
      ? processingData.providers
      : [];
    const provider = providers.find(
      (item) => Number(item.id) === Number(order?.providerId),
    );
    const contacts = Array.isArray(provider?.contacts) ? provider.contacts : [];
    const providerContact = contacts.find(
      (contact) =>
        Number(contact.id) === Number(stage?.stageData?.providerContactId),
    );
    const providerContactName = providerContact
      ? [providerContact.firstName, providerContact.lastName]
          .filter(Boolean)
          .join(" ") ||
        providerContact.email ||
        ""
      : "";
    const paymentTermsCode = String(
      quotationToProcess?.latestPaymentTerms || "",
    );
    const defaultPaymentConditions =
      quotationPaymentTerms.find(
        (option) => String(option.code || "") === paymentTermsCode,
      )?.name || paymentTermsCode;

    setGeneratedPurchaseOrderPreviewModel(
      buildPurchaseOrderPrintModel({
        quotation: quotationToProcess,
        orders: [order],
        currencyCode: order?.currencyCode || processingCurrencyCode || "USD",
        providerQuotation: stage?.stageData?.providerQuotation || "",
        providerContactName,
        paymentConditions:
          stage?.stageData?.purchaseOrderPaymentConditions ??
          defaultPaymentConditions,
        notes:
          stage?.stageData?.purchaseOrderNotes ?? DEFAULT_PURCHASE_ORDER_NOTES,
      }),
    );
  }

  function patchProcessingStage(stageCode, patch) {
    setProcessingData((current) => {
      const nextStages = (
        Array.isArray(current.stages) ? current.stages : []
      ).map((stage) => {
        if (stage.stageCode !== stageCode) return stage;
        return {
          ...stage,
          ...patch,
          stageData: {
            ...(stage.stageData || {}),
            ...(patch.stageData || {}),
          },
        };
      });
      return {
        ...current,
        stages: nextStages,
      };
    });
    setProcessingDirty(true);
  }

  async function saveProcessingStage(stageCode, options = {}) {
    const quotationId = Number(quotationToProcess?.id || 0);
    const stage = (processingData.stages || []).find(
      (item) => item.stageCode === stageCode,
    );
    if (!quotationId || !stage) return;

    setProcessingSavingStageCode(stageCode);
    setError("");
    setSuccess("");
    try {
      const nextStageData = {
        ...(stage.stageData || {}),
        ...(options.stageDataPatch && typeof options.stageDataPatch === "object"
          ? options.stageDataPatch
          : {}),
      };

      const payload = {
        status: options.forceStatus || stage.status || "not_started",
        ownerUserId: stage.ownerUserId || null,
        targetDate: stage.targetDate || null,
        completedAt:
          options.forceCompletedAt !== undefined
            ? options.forceCompletedAt
            : stage.completedAt || null,
        blockedReason: stage.blockedReason || null,
        notes: stage.notes || null,
        stageData: nextStageData,
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

    const optionOne = String(
      kickoffInvitationDraft.meetingDateOptionOne || "",
    ).trim();
    const optionTwo = String(
      kickoffInvitationDraft.meetingDateOptionTwo || "",
    ).trim();
    if (statusCode === "sent" && (!optionOne || !optionTwo)) {
      setError(
        "Selecciona las dos fechas propuestas antes de enviar la convocatoria",
      );
      return;
    }

    const preparedEmail = buildKickoffInternalEmailPreview({
      quotation: quotationToProcess,
      draft: {
        ...kickoffInvitationDraft,
        assignableUsers: processingUsers,
      },
    });

    setSavingKickoffInvitation(true);
    setError("");
    setSuccess("");
    try {
      const payload = {
        meetingDate: optionOne || null,
        meetingTime:
          String(kickoffInvitationDraft.meetingTimeOptionOne || "").trim() ||
          null,
        meetingMode: kickoffInvitationDraft.meetingMode || null,
        meetingLocation: kickoffInvitationDraft.meetingLocation || null,
        meetingLink: null,
        inviteSubject: preparedEmail.subject,
        inviteBodyTemplate: preparedEmail.body,
        internalAttendeesUserIds:
          kickoffInvitationDraft.internalAttendeesUserIds,
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

  function openKickoffInvitationPreviewModal() {
    const preparedEmail = buildKickoffInternalEmailPreview({
      quotation: quotationToProcess,
      draft: {
        ...kickoffInvitationDraft,
        assignableUsers: processingUsers,
      },
    });
    setKickoffInvitationDraft((current) => ({
      ...current,
      inviteSubject: preparedEmail.subject,
      inviteBodyTemplate: preparedEmail.body,
    }));
    setKickoffInvitationModalOpen(true);
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

  async function uploadKickoffInternalEvidence(files) {
    const quotationId = Number(quotationToProcess?.id || 0);
    if (!quotationId || !files?.length) return;

    setUploadingKickoffInternalEvidence(true);
    setError("");
    setSuccess("");
    try {
      const formData = new FormData();
      Array.from(files).forEach((file) => {
        formData.append("files", file);
      });
      await api.post(
        `/api/quotations/${quotationId}/processing/kickoff-internal/evidences/files`,
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
          timeout: 120000,
        },
      );
      await loadQuotationProcessing(quotationToProcess, "kickoff_internal");
      setSuccess("Minuta cargada en Kick Off interno");
    } catch (uploadError) {
      setError(
        getApiErrorMessage(
          uploadError,
          "No fue posible cargar la minuta en Kick Off interno",
        ),
      );
    } finally {
      setUploadingKickoffInternalEvidence(false);
    }
  }

  async function uploadReceptionEvidence(files, itemKey) {
    const quotationId = Number(quotationToProcess?.id || 0);
    if (!quotationId || !files?.length) return;
    setUploadingReceptionEvidence(true);
    setError("");
    setSuccess("");
    try {
      const formData = new FormData();
      Array.from(files).forEach((file) => formData.append("files", file));
      const itemKeyParam = itemKey ? `?itemKey=${encodeURIComponent(itemKey)}` : "";
      await api.post(
        `/api/quotations/${quotationId}/processing/products-reception/evidence-files${itemKeyParam}`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      await loadQuotationProcessing(quotationToProcess, "products_reception");
      setSuccess("Documento cargado en recepcion de productos");
    } catch (uploadError) {
      setError(
        getApiErrorMessage(uploadError, "No fue posible cargar el documento"),
      );
    } finally {
      setUploadingReceptionEvidence(false);
    }
  }

  async function generateKickoffInternalAiSummary() {
    const quotationId = Number(quotationToProcess?.id || 0);
    if (!quotationId) return;

    setGeneratingKickoffInternalAi(true);
    setError("");
    setSuccess("");
    try {
      const { data } = await api.post(
        `/api/quotations/${quotationId}/processing/kickoff-internal/ai-summary`,
        null,
        {
          timeout: 120000,
        },
      );
      await loadQuotationProcessing(quotationToProcess, "kickoff_internal");
      const summaryText = String(
        data?.aiSummaryCurrent?.summary?.summary || "",
      ).trim();
      if (summaryText) {
        updateActiveStageDataField("minutesSummary", summaryText);
      }
      setSuccess("Resumen IA generado para Minuta de Kick Off interno");
    } catch (aiError) {
      setError(
        getApiErrorMessage(aiError, "No fue posible generar el resumen IA"),
      );
    } finally {
      setGeneratingKickoffInternalAi(false);
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
      const { data } = await api.post(
        `/api/quotations/${quotationId}/processing/kickoff-external/ai-summary`,
        null,
        {
          timeout: 120000,
        },
      );
      await loadQuotationProcessing(quotationToProcess, "kickoff_external");
      const summaryText = String(
        data?.aiSummaryCurrent?.summary?.summary || "",
      ).trim();
      if (summaryText) {
        updateActiveStageDataField("minutesSummary", summaryText);
      }
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
        getApiErrorMessage(
          downloadError,
          "No fue posible descargar la evidencia",
        ),
      );
    }
  }

  async function deleteKickoffEvidence(evidence) {
    const quotationId = Number(quotationToProcess?.id || 0);
    const evidenceId = Number(evidence?.id || 0);
    const stageCode = String(
      evidence?.stageCode || activeProcessingStageCode || "",
    ).trim();
    if (!quotationId || !evidenceId || !stageCode) return;

    const evidenceLabel =
      evidence?.document?.originalFileName ||
      (evidence?.evidenceType === "manual_note"
        ? "minuta manual"
        : "evidencia");
    const shouldDelete = window.confirm(
      `Se eliminara \"${evidenceLabel}\". Esta accion no se puede deshacer.`,
    );
    if (!shouldDelete) return;

    setDeletingProcessingEvidenceIds((current) => {
      const next = new Set(current);
      next.add(evidenceId);
      return next;
    });
    setError("");
    setSuccess("");
    try {
      const { data } = await api.delete(
        `/api/quotations/${quotationId}/processing/evidences/${evidenceId}`,
      );
      await loadQuotationProcessing(
        quotationToProcess,
        stageCode || String(data?.stageCode || "").trim(),
      );
      setSuccess("Evidencia eliminada");
    } catch (deleteError) {
      setError(
        getApiErrorMessage(deleteError, "No fue posible eliminar la evidencia"),
      );
    } finally {
      setDeletingProcessingEvidenceIds((current) => {
        const next = new Set(current);
        next.delete(evidenceId);
        return next;
      });
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

  function updateStageProductAssignmentState(
    stageCode,
    productAssignments,
    productAssignmentDuplicates,
    productAssignmentExtras,
  ) {
    patchProcessingStage(stageCode, {
      stageData: {
        productAssignments,
        productAssignmentDuplicates,
        productAssignmentExtras,
      },
    });
  }

  function renderStageBaseSpecificFields(stage) {
    const fieldList = BASE_STAGE_SPECIFIC_FIELDS[stage.stageCode] || [];
    if (!fieldList.length && stage.stageCode !== "provider_purchase_order") {
      return null;
    }
    const baseProductAssignments =
      stage?.stageData && typeof stage.stageData.productAssignments === "object"
        ? stage.stageData.productAssignments
        : {};
    const baseProductAssignmentDuplicates =
      stage?.stageData &&
      typeof stage.stageData.productAssignmentDuplicates === "object"
        ? stage.stageData.productAssignmentDuplicates
        : {};
    const baseProductAssignmentExtras =
      stage?.stageData &&
      typeof stage.stageData.productAssignmentExtras === "object"
        ? stage.stageData.productAssignmentExtras
        : {};
    const generatedPurchaseOrders = Array.isArray(
      stage?.stageData?.generatedPurchaseOrders,
    )
      ? stage.stageData.generatedPurchaseOrders
      : [];
    const {
      productAssignments: rawProductAssignments,
      productAssignmentDuplicates: rawProductAssignmentDuplicates,
      productAssignmentExtras: rawProductAssignmentExtras,
    } = hydrateAssignmentsFromGeneratedOrders({
      products: processingQuotationProducts,
      productAssignments: baseProductAssignments,
      productAssignmentDuplicates: baseProductAssignmentDuplicates,
      productAssignmentExtras: baseProductAssignmentExtras,
      generatedPurchaseOrders,
    });
    const providerPurchaseOrderRows = buildProviderPurchaseOrderRows({
      products: processingQuotationProducts,
      productAssignments: rawProductAssignments,
      productAssignmentDuplicates: rawProductAssignmentDuplicates,
      productAssignmentExtras: rawProductAssignmentExtras,
    });
    const providerPurchaseOrderTotalCost = providerPurchaseOrderRows.reduce(
      (sum, item) => {
        const itemKey = String(item.assignmentKey || item.id || "");
        const assignment = (itemKey && rawProductAssignments[itemKey]) || {};
        const quantity = Number(
          assignment?.quantity == null || assignment?.quantity === ""
            ? item.quantity || 0
            : assignment.quantity,
        );
        const unitCost = Number(
          assignment?.unitCostWithDiscount == null ||
            assignment?.unitCostWithDiscount === ""
            ? item.unitCostWithDiscount || 0
            : assignment.unitCostWithDiscount,
        );
        return (
          sum +
          (Number.isFinite(quantity) && Number.isFinite(unitCost)
            ? quantity * unitCost
            : 0)
        );
      },
      0,
    );
    const selectedProductIds = new Set(
      Object.entries(rawProductAssignments)
        .filter(([, assignment]) => Boolean(assignment?.selected))
        .map(([itemKey]) => String(itemKey)),
    );
    const selectedPurchaseOrderLines = buildPurchaseOrderLines({
      products: providerPurchaseOrderRows,
      productAssignments: rawProductAssignments,
      providers: processingProviders,
    }).filter((line) => selectedProductIds.has(String(line.lineId || "")));
    const selectedProviderIds = new Set(
      selectedPurchaseOrderLines
        .map((line) => Number(line.providerId || 0))
        .filter((providerId) => providerId > 0),
    );
    const hasSelectedLinesWithoutProvider = selectedPurchaseOrderLines.some(
      (line) => !Number(line.providerId || 0),
    );
    const selectedProviderId =
      selectedProviderIds.size === 1 && !hasSelectedLinesWithoutProvider
        ? Array.from(selectedProviderIds)[0]
        : null;
    const selectedProvider = selectedProviderId
      ? processingProviders.find(
          (provider) => Number(provider.id) === selectedProviderId,
        ) || null
      : null;
    const selectedProviderContacts = Array.isArray(selectedProvider?.contacts)
      ? selectedProvider.contacts
      : [];
    const savedProviderContactId = Number(
      stage?.stageData?.providerContactId || 0,
    );
    const selectedProviderContactId = selectedProviderContacts.some(
      (contact) => Number(contact.id) === savedProviderContactId,
    )
      ? savedProviderContactId
      : "";
    const purchaseOrderStage = (processingData.stages || []).find(
      (item) => item.stageCode === "provider_purchase_order",
    );
    const receptionPurchaseOrders = Array.isArray(
      purchaseOrderStage?.stageData?.generatedPurchaseOrders,
    )
      ? purchaseOrderStage.stageData.generatedPurchaseOrders
      : [];
    const productsReceptionStage = (processingData.stages || []).find(
      (item) => item.stageCode === "products_reception",
    );
    const receptionItems =
      productsReceptionStage?.stageData?.receptionItems &&
      typeof productsReceptionStage.stageData.receptionItems === "object"
        ? productsReceptionStage.stageData.receptionItems
        : {};
    const preworksStage = (processingData.stages || []).find(
      (item) => item.stageCode === "preworks",
    );
    const preworksItems =
      preworksStage?.stageData?.preworksItems &&
      typeof preworksStage.stageData.preworksItems === "object"
        ? preworksStage.stageData.preworksItems
        : {};
    const productsDeliveryStage = (processingData.stages || []).find(
      (item) => item.stageCode === "products_delivery",
    );
    const deliveryItems =
      productsDeliveryStage?.stageData?.deliveryItems &&
      typeof productsDeliveryStage.stageData.deliveryItems === "object"
        ? productsDeliveryStage.stageData.deliveryItems
        : {};
    const generatedPurchaseOrdersTotal = generatedPurchaseOrders.reduce(
      (sum, order) => sum + Number(order?.total || 0),
      0,
    );
    const generatedPurchaseOrdersSubtotal = generatedPurchaseOrders.reduce(
      (sum, order) => sum + Number(order?.subtotal || 0),
      0,
    );
    const generatedAssignmentKeys = new Set(
      generatedPurchaseOrders.flatMap((order) =>
        (Array.isArray(order?.lines) ? order.lines : [])
          .map((line) => String(line?.sourceAssignmentKey || "").trim())
          .filter(Boolean),
      ),
    );
    const deliveryTimeCode = String(
      quotationToProcess?.latestDeliveryTime || "",
    );
    const deliveryTimeName =
      quotationDeliveryTimes.find(
        (option) => String(option.code || "") === deliveryTimeCode,
      )?.name || deliveryTimeCode;
    const paymentTermsCode = String(
      quotationToProcess?.latestPaymentTerms || "",
    );
    const paymentTermsName =
      quotationPaymentTerms.find(
        (option) => String(option.code || "") === paymentTermsCode,
      )?.name || paymentTermsCode;
    const quotationCommercialFields = [
      {
        key: "commercialDeliveryTime",
        label: "Tiempo de entrega",
        value: deliveryTimeName,
      },
      {
        key: "commercialCurrency",
        label: "Moneda",
        value: quotationToProcess?.latestCurrencyCode || "",
      },
    ];

    return (
      <section className="processing-stage-box">
        {stage.stageCode !== "products_reception" &&
        stage.stageCode !== "preworks" &&
        stage.stageCode !== "products_delivery" ? (
          <>
            <header>
              <h5>Listado de productos y servicios de la cotización</h5>
            </header>
            <div className="processing-stage-grid two">
              {fieldList.length
                ? fieldList.map((field) => {
                    const value = stage?.stageData?.[field.key] ?? "";
                    if (field.type === "textarea") {
                      return (
                        <label
                          key={field.key}
                          className="field-group processing-stage-field full"
                        >
                          <span>{field.label}</span>
                          <textarea
                            value={value}
                            onChange={(event) =>
                              updateActiveStageDataField(
                                field.key,
                                event.target.value,
                              )
                            }
                            rows={4}
                            placeholder={field.placeholder || ""}
                            disabled={!processingData.permissions?.canUpdate}
                          />
                        </label>
                      );
                    }

                    return (
                      <label
                        key={field.key}
                        className="field-group processing-stage-field"
                      >
                        <span>{field.label}</span>
                        <input
                          type={field.type}
                          value={value}
                          placeholder={field.placeholder || ""}
                          onChange={(event) =>
                            updateActiveStageDataField(
                              field.key,
                              event.target.value,
                            )
                          }
                          disabled={!processingData.permissions?.canUpdate}
                        />
                      </label>
                    );
                  })
                : null}
            </div>
          </>
        ) : null}

        {stage.stageCode === "products_reception" ? (
          <section className="processing-products-box">
            <header>
              <h6>Ordenes de compra generadas</h6>
              <p>Productos y servicios incluidos en cada orden de compra.</p>
            </header>

            {receptionPurchaseOrders.length ? (() => {
              const receptionEvidences = Array.isArray(processingData?.receptionEvidences)
                ? processingData.receptionEvidences
                : [];
              const evidencesByItemKey = new Map();
              receptionEvidences.forEach((ev) => {
                try {
                  const parsed = ev.contentText ? JSON.parse(ev.contentText) : null;
                  const key = String(parsed?.itemKey || "");
                  if (!key) return;
                  if (!evidencesByItemKey.has(key)) evidencesByItemKey.set(key, []);
                  evidencesByItemKey.get(key).push(ev);
                } catch { /* non-JSON contentText */ }
              });
              return (
              <div className="processing-reception-orders">
                {receptionPurchaseOrders.map((order, orderIndex) => {
                  const orderLines = Array.isArray(order?.lines)
                    ? order.lines
                    : [];
                  const currencyCode =
                    order?.currencyCode || processingCurrencyCode || "USD";
                  const orderKey = String(order?.orderId || order?.orderNumber || orderIndex);
                  const receptionItemExtras = Array.isArray(
                    productsReceptionStage?.stageData?.receptionItemExtras,
                  )
                    ? productsReceptionStage.stageData.receptionItemExtras
                    : [];
                  const orderExtras = receptionItemExtras.filter(
                    (e) => String(e.orderId || "") === orderKey,
                  );

                  return (
                    <article
                      key={orderKey}
                      className="processing-reception-order"
                    >
                      <header className="processing-reception-order-header">
                        <div>
                          <h6>{order?.orderNumber || "Orden de compra"}</h6>
                          <p>{order?.providerName || "Proveedor"}</p>
                        </div>
                        <span>{formatDate(order?.orderDate)}</span>
                      </header>

                      {orderLines.length ? (
                        <div className="processing-products-table-wrap">
                          <table className="processing-products-table">
                            <thead>
                              <tr>
                                <th>Codigo</th>
                                <th>Producto o servicio</th>
                                <th className="is-right">Cantidad</th>
                                <th className="is-right">Costo unitario</th>
                                <th>Fecha</th>
                                <th className="is-right">Total</th>
                                <th className="is-center">Recibido</th>
                                <th>Fecha de recepcion</th>
                                <th>Inicio soporte/suscripcion</th>
                                <th>Fin soporte/suscripcion</th>
                                <th>Documentos</th>
                                <th className="is-center">Acciones</th>
                              </tr>
                            </thead>
                            <tbody>
                              {orderLines.map((line, lineIndex) => {
                                const receptionItemKey = `${orderKey}:${line?.productId || line?.code || lineIndex}:${lineIndex}`;
                                const receptionItem =
                                  receptionItems[receptionItemKey] || {};
                                const effectiveQuantity =
                                  receptionItem.quantityOverride != null
                                    ? receptionItem.quantityOverride
                                    : Number(line?.quantity || 0);
                                const updateReceptionItem = (patch) =>
                                  updateActiveStageDataField("receptionItems", {
                                    ...receptionItems,
                                    [receptionItemKey]: {
                                      ...receptionItem,
                                      ...patch,
                                    },
                                  });

                                return (
                                  <tr key={receptionItemKey}>
                                    <td>{line?.code || "-"}</td>
                                    <td>
                                      {line?.description || "Sin descripcion"}
                                    </td>
                                    <td className="is-right">
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.0001"
                                        value={String(effectiveQuantity)}
                                        onChange={(e) =>
                                          updateReceptionItem({
                                            quantityOverride: e.target.value === "" ? null : Number(e.target.value),
                                          })
                                        }
                                        disabled={!processingData.permissions?.canUpdate}
                                        style={{ width: 80, textAlign: "right" }}
                                      />
                                    </td>
                                    <td className="is-right">
                                      {formatCurrency(
                                        Number(line?.unitCost || 0),
                                        currencyCode,
                                      )}
                                    </td>
                                    <td>{formatDate(line?.selectionDate)}</td>
                                    <td className="is-right">
                                      {formatCurrency(
                                        Number(effectiveQuantity) * Number(line?.unitCost || 0),
                                        currencyCode,
                                      )}
                                    </td>
                                    <td className="is-center">
                                      <input
                                        type="checkbox"
                                        checked={Boolean(
                                          receptionItem.received,
                                        )}
                                        onChange={(event) =>
                                          updateReceptionItem({
                                            received: event.target.checked,
                                          })
                                        }
                                        disabled={
                                          !processingData.permissions?.canUpdate
                                        }
                                        aria-label={`Marcar ${line?.description || line?.code || "item"} como recibido`}
                                      />
                                    </td>
                                    <td>
                                      <DatePicker
                                        selected={parseDateInputValue(
                                          receptionItem.receptionDate,
                                        )}
                                        onChange={(date) =>
                                          updateReceptionItem({
                                            receptionDate:
                                              formatDatePickerValue(date),
                                          })
                                        }
                                        dateFormat="dd-MM-yyyy"
                                        locale={es}
                                        showMonthDropdown
                                        showYearDropdown
                                        dropdownMode="select"
                                        fixedHeight
                                        calendarClassName="audit-datepicker-calendar processing-date-calendar"
                                        popperClassName="audit-datepicker-popper"
                                        className="processing-date-input"
                                        dayClassName={(date) =>
                                          formatDatePickerValue(date) ===
                                          getTodayBusinessDate()
                                            ? "processing-date-business-today"
                                            : undefined
                                        }
                                        autoComplete="off"
                                        showPopperArrow={false}
                                        disabled={
                                          !processingData.permissions?.canUpdate
                                        }
                                        placeholderText="Seleccionar fecha"
                                      />
                                    </td>
                                    <td>
                                      <DatePicker
                                        selected={parseDateInputValue(receptionItem.supportStartDate)}
                                        onChange={(date) => updateReceptionItem({ supportStartDate: formatDatePickerValue(date) })}
                                        dateFormat="dd-MM-yyyy"
                                        locale={es}
                                        showMonthDropdown
                                        showYearDropdown
                                        dropdownMode="select"
                                        fixedHeight
                                        calendarClassName="audit-datepicker-calendar processing-date-calendar"
                                        popperClassName="audit-datepicker-popper"
                                        className="processing-date-input"
                                        autoComplete="off"
                                        showPopperArrow={false}
                                        disabled={!processingData.permissions?.canUpdate}
                                        placeholderText="Inicio soporte"
                                      />
                                    </td>
                                    <td>
                                      <DatePicker
                                        selected={parseDateInputValue(receptionItem.supportEndDate)}
                                        onChange={(date) => updateReceptionItem({ supportEndDate: formatDatePickerValue(date) })}
                                        dateFormat="dd-MM-yyyy"
                                        locale={es}
                                        showMonthDropdown
                                        showYearDropdown
                                        dropdownMode="select"
                                        fixedHeight
                                        calendarClassName="audit-datepicker-calendar processing-date-calendar"
                                        popperClassName="audit-datepicker-popper"
                                        className="processing-date-input"
                                        autoComplete="off"
                                        showPopperArrow={false}
                                        disabled={!processingData.permissions?.canUpdate}
                                        placeholderText="Fin soporte"
                                      />
                                    </td>
                                    <td style={{ minWidth: 160 }}>
                                      {(evidencesByItemKey.get(receptionItemKey) || []).map((ev) => {
                                        const evId = Number(ev.id || 0);
                                        const deleting = deletingProcessingEvidenceIds.has(evId);
                                        return (
                                          <div key={ev.id} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                                            <span style={{ fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={ev.document?.originalFileName}>
                                              {ev.document?.originalFileName || "Documento"}
                                            </span>
                                            {ev.document ? (
                                              <button type="button" className="btn-ghost processing-evidence-icon-button" onClick={() => void downloadKickoffEvidence(ev)} disabled={deleting} title="Descargar" aria-label="Descargar documento">
                                                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.75a.75.75 0 0 1 .75.75v8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 1 1 1.06-1.06l2.72 2.72V4.5a.75.75 0 0 1 .75-.75ZM5 18.25a.75.75 0 0 1 .75.75v.25a1 1 0 0 0 1 1h10.5a1 1 0 0 0 1-1V19a.75.75 0 0 1 1.5 0v.25a2.5 2.5 0 0 1-2.5 2.5H6.75a2.5 2.5 0 0 1-2.5-2.5V19a.75.75 0 0 1 .75-.75Z" /></svg>
                                              </button>
                                            ) : null}
                                            <button type="button" className="btn-ghost processing-evidence-icon-button is-danger" onClick={() => void deleteKickoffEvidence(ev)} disabled={deleting || !processingData.permissions?.canUpdate} title="Eliminar" aria-label="Eliminar documento">
                                              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.25 4a.75.75 0 0 1 .75-.75h4a.75.75 0 0 1 .75.75V5h3a.75.75 0 0 1 0 1.5h-.76l-.63 11.01A2.75 2.75 0 0 1 14.37 20h-4.74a2.75 2.75 0 0 1-2.74-2.49L6.26 6.5H5.5a.75.75 0 0 1 0-1.5h3zm1.5.75V5h2.5v-.25zM7.76 6.5l.62 10.92c.04.66.58 1.18 1.25 1.18h4.74c.67 0 1.21-.52 1.25-1.18l.62-10.92z" /></svg>
                                            </button>
                                          </div>
                                        );
                                      })}
                                      <label style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "#3b82f6" }}>
                                        <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, fill: "currentColor" }} aria-hidden="true"><path d="M12 4.5a.75.75 0 0 1 .75.75v6h6a.75.75 0 0 1 0 1.5h-6v6a.75.75 0 0 1-1.5 0v-6h-6a.75.75 0 0 1 0-1.5h6v-6A.75.75 0 0 1 12 4.5Z" /></svg>
                                        {uploadingReceptionEvidence ? "Subiendo..." : "Adjuntar"}
                                        <input
                                          type="file"
                                          style={{ display: "none" }}
                                          accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt,.csv"
                                          onChange={(e) => {
                                            if (e.target.files?.length) void uploadReceptionEvidence(e.target.files, receptionItemKey);
                                            e.target.value = "";
                                          }}
                                          disabled={uploadingReceptionEvidence || !processingData.permissions?.canUpdate}
                                        />
                                      </label>
                                    </td>
                                    <td className="is-center">
                                      <button
                                        type="button"
                                        className="btn-secondary processing-product-action-icon"
                                        title="Duplicar item"
                                        aria-label={`Duplicar ${line?.description || line?.code || "item"}`}
                                        disabled={!processingData.permissions?.canUpdate}
                                        onClick={() => {
                                          const nextExtras = [
                                            ...receptionItemExtras,
                                            {
                                              id: `dup-${Date.now()}-${Math.round(Math.random() * 9999)}`,
                                              orderId: orderKey,
                                              code: line?.code || "-",
                                              description: line?.description || "Sin descripcion",
                                              unitCost: Number(line?.unitCost || 0),
                                              quantityOverride: Number(effectiveQuantity),
                                              received: false,
                                              receptionDate: "",
                                              supportStartDate: receptionItem.supportStartDate || "",
                                              supportEndDate: receptionItem.supportEndDate || "",
                                              selectionDate: line?.selectionDate || null,
                                              currencyCode,
                                            },
                                          ];
                                          patchProcessingStage("products_reception", {
                                            stageData: { receptionItemExtras: nextExtras },
                                          });
                                        }}
                                      >
                                        <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                                          <path d="M8 4.75A2.75 2.75 0 0 0 5.25 7.5v8A2.75 2.75 0 0 0 8 18.25h8a2.75 2.75 0 0 0 2.75-2.75v-8A2.75 2.75 0 0 0 16 4.75zm0 1.5h8c.69 0 1.25.56 1.25 1.25v8c0 .69-.56 1.25-1.25 1.25H8c-.69 0-1.25-.56-1.25-1.25v-8c0-.69.56-1.25 1.25-1.25" />
                                          <path d="M4 8.5a.75.75 0 0 1 .75.75v8c0 .69.56 1.25 1.25 1.25h8a.75.75 0 0 1 0 1.5H6A2.75 2.75 0 0 1 3.25 17.25v-8A.75.75 0 0 1 4 8.5" />
                                        </svg>
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                              {orderExtras.map((extra) => (
                                <tr key={extra.id} style={{ background: "#f8faff" }}>
                                  <td style={{ color: "#64748b", fontStyle: "italic" }}>{extra.code}</td>
                                  <td style={{ color: "#64748b", fontStyle: "italic" }}>{extra.description}</td>
                                  <td className="is-right">
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.0001"
                                      value={String(extra.quantityOverride ?? 0)}
                                      onChange={(e) => {
                                        const nextExtras = receptionItemExtras.map((ex) =>
                                          ex.id === extra.id
                                            ? { ...ex, quantityOverride: e.target.value === "" ? 0 : Number(e.target.value) }
                                            : ex,
                                        );
                                        patchProcessingStage("products_reception", {
                                          stageData: { receptionItemExtras: nextExtras },
                                        });
                                      }}
                                      disabled={!processingData.permissions?.canUpdate}
                                      style={{ width: 80, textAlign: "right" }}
                                    />
                                  </td>
                                  <td className="is-right">
                                    {formatCurrency(extra.unitCost, extra.currencyCode)}
                                  </td>
                                  <td>{formatDate(extra.selectionDate)}</td>
                                  <td className="is-right">
                                    {formatCurrency(
                                      Number(extra.quantityOverride ?? 0) * Number(extra.unitCost || 0),
                                      extra.currencyCode,
                                    )}
                                  </td>
                                  <td className="is-center">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(extra.received)}
                                      onChange={(e) => {
                                        const nextExtras = receptionItemExtras.map((ex) =>
                                          ex.id === extra.id ? { ...ex, received: e.target.checked } : ex,
                                        );
                                        patchProcessingStage("products_reception", {
                                          stageData: { receptionItemExtras: nextExtras },
                                        });
                                      }}
                                      disabled={!processingData.permissions?.canUpdate}
                                    />
                                  </td>
                                  <td>
                                    <DatePicker
                                      selected={parseDateInputValue(extra.receptionDate)}
                                      onChange={(date) => {
                                        const nextExtras = receptionItemExtras.map((ex) =>
                                          ex.id === extra.id ? { ...ex, receptionDate: formatDatePickerValue(date) } : ex,
                                        );
                                        patchProcessingStage("products_reception", {
                                          stageData: { receptionItemExtras: nextExtras },
                                        });
                                      }}
                                      dateFormat="dd-MM-yyyy"
                                      locale={es}
                                      showMonthDropdown
                                      showYearDropdown
                                      dropdownMode="select"
                                      fixedHeight
                                      calendarClassName="audit-datepicker-calendar processing-date-calendar"
                                      popperClassName="audit-datepicker-popper"
                                      className="processing-date-input"
                                      autoComplete="off"
                                      showPopperArrow={false}
                                      disabled={!processingData.permissions?.canUpdate}
                                      placeholderText="Seleccionar fecha"
                                    />
                                  </td>
                                  <td>
                                    <DatePicker
                                      selected={parseDateInputValue(extra.supportStartDate)}
                                      onChange={(date) => {
                                        const nextExtras = receptionItemExtras.map((ex) =>
                                          ex.id === extra.id ? { ...ex, supportStartDate: formatDatePickerValue(date) } : ex,
                                        );
                                        patchProcessingStage("products_reception", { stageData: { receptionItemExtras: nextExtras } });
                                      }}
                                      dateFormat="dd-MM-yyyy"
                                      locale={es}
                                      showMonthDropdown
                                      showYearDropdown
                                      dropdownMode="select"
                                      fixedHeight
                                      calendarClassName="audit-datepicker-calendar processing-date-calendar"
                                      popperClassName="audit-datepicker-popper"
                                      className="processing-date-input"
                                      autoComplete="off"
                                      showPopperArrow={false}
                                      disabled={!processingData.permissions?.canUpdate}
                                      placeholderText="Inicio soporte"
                                    />
                                  </td>
                                  <td>
                                    <DatePicker
                                      selected={parseDateInputValue(extra.supportEndDate)}
                                      onChange={(date) => {
                                        const nextExtras = receptionItemExtras.map((ex) =>
                                          ex.id === extra.id ? { ...ex, supportEndDate: formatDatePickerValue(date) } : ex,
                                        );
                                        patchProcessingStage("products_reception", { stageData: { receptionItemExtras: nextExtras } });
                                      }}
                                      dateFormat="dd-MM-yyyy"
                                      locale={es}
                                      showMonthDropdown
                                      showYearDropdown
                                      dropdownMode="select"
                                      fixedHeight
                                      calendarClassName="audit-datepicker-calendar processing-date-calendar"
                                      popperClassName="audit-datepicker-popper"
                                      className="processing-date-input"
                                      autoComplete="off"
                                      showPopperArrow={false}
                                      disabled={!processingData.permissions?.canUpdate}
                                      placeholderText="Fin soporte"
                                    />
                                  </td>
                                  <td style={{ minWidth: 160 }}>
                                    {(evidencesByItemKey.get(extra.id) || []).map((ev) => {
                                      const evId = Number(ev.id || 0);
                                      const deleting = deletingProcessingEvidenceIds.has(evId);
                                      return (
                                        <div key={ev.id} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                                          <span style={{ fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={ev.document?.originalFileName}>
                                            {ev.document?.originalFileName || "Documento"}
                                          </span>
                                          {ev.document ? (
                                            <button type="button" className="btn-ghost processing-evidence-icon-button" onClick={() => void downloadKickoffEvidence(ev)} disabled={deleting} title="Descargar" aria-label="Descargar documento">
                                              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.75a.75.75 0 0 1 .75.75v8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 1 1 1.06-1.06l2.72 2.72V4.5a.75.75 0 0 1 .75-.75ZM5 18.25a.75.75 0 0 1 .75.75v.25a1 1 0 0 0 1 1h10.5a1 1 0 0 0 1-1V19a.75.75 0 0 1 1.5 0v.25a2.5 2.5 0 0 1-2.5 2.5H6.75a2.5 2.5 0 0 1-2.5-2.5V19a.75.75 0 0 1 .75-.75Z" /></svg>
                                            </button>
                                          ) : null}
                                          <button type="button" className="btn-ghost processing-evidence-icon-button is-danger" onClick={() => void deleteKickoffEvidence(ev)} disabled={deleting || !processingData.permissions?.canUpdate} title="Eliminar" aria-label="Eliminar documento">
                                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.25 4a.75.75 0 0 1 .75-.75h4a.75.75 0 0 1 .75.75V5h3a.75.75 0 0 1 0 1.5h-.76l-.63 11.01A2.75 2.75 0 0 1 14.37 20h-4.74a2.75 2.75 0 0 1-2.74-2.49L6.26 6.5H5.5a.75.75 0 0 1 0-1.5h3zm1.5.75V5h2.5v-.25zM7.76 6.5l.62 10.92c.04.66.58 1.18 1.25 1.18h4.74c.67 0 1.21-.52 1.25-1.18l.62-10.92z" /></svg>
                                          </button>
                                        </div>
                                      );
                                    })}
                                    <label style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "#3b82f6" }}>
                                      <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, fill: "currentColor" }} aria-hidden="true"><path d="M12 4.5a.75.75 0 0 1 .75.75v6h6a.75.75 0 0 1 0 1.5h-6v6a.75.75 0 0 1-1.5 0v-6h-6a.75.75 0 0 1 0-1.5h6v-6A.75.75 0 0 1 12 4.5Z" /></svg>
                                      {uploadingReceptionEvidence ? "Subiendo..." : "Adjuntar"}
                                      <input
                                        type="file"
                                        style={{ display: "none" }}
                                        accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt,.csv"
                                        onChange={(e) => {
                                          if (e.target.files?.length) void uploadReceptionEvidence(e.target.files, extra.id);
                                          e.target.value = "";
                                        }}
                                        disabled={uploadingReceptionEvidence || !processingData.permissions?.canUpdate}
                                      />
                                    </label>
                                  </td>
                                  <td className="is-center">
                                    <button
                                      type="button"
                                      className="btn-secondary processing-product-action-icon is-danger"
                                      title="Eliminar copia"
                                      aria-label="Eliminar item duplicado"
                                      disabled={!processingData.permissions?.canUpdate}
                                      onClick={() => {
                                        patchProcessingStage("products_reception", {
                                          stageData: {
                                            receptionItemExtras: receptionItemExtras.filter((ex) => ex.id !== extra.id),
                                          },
                                        });
                                      }}
                                    >
                                      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                                        <path d="M9.25 4a.75.75 0 0 1 .75-.75h4a.75.75 0 0 1 .75.75V5h3a.75.75 0 0 1 0 1.5h-.76l-.63 11.01A2.75 2.75 0 0 1 14.37 20h-4.74a2.75 2.75 0 0 1-2.74-2.49L6.26 6.5H5.5a.75.75 0 0 1 0-1.5h3zm1.5.75V5h2.5v-.25zM7.76 6.5l.62 10.92c.04.66.58 1.18 1.25 1.18h4.74c.67 0 1.21-.52 1.25-1.18l.62-10.92z" />
                                        <path d="M10.75 9a.75.75 0 0 1 .75.75v5a.75.75 0 0 1-1.5 0v-5a.75.75 0 0 1 .75-.75m2.5 0a.75.75 0 0 1 .75.75v5a.75.75 0 0 1-1.5 0v-5a.75.75 0 0 1 .75-.75" />
                                      </svg>
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="field-hint">
                          Esta orden no tiene productos o servicios.
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
              );
            })() : (
              <p className="field-hint">
                Aun no hay ordenes de compra generadas.
              </p>
            )}

            <div className="processing-stage-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void saveProcessingStage(stage.stageCode)}
                disabled={
                  !processingData.permissions?.canUpdate ||
                  processingSavingStageCode === stage.stageCode
                }
              >
                {processingSavingStageCode === stage.stageCode
                  ? "Guardando..."
                  : "Guardar recepcion"}
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() =>
                  void saveProcessingStage(stage.stageCode, {
                    forceStatus: "completed",
                    forceCompletedAt: new Date().toISOString(),
                  })
                }
                disabled={
                  !processingData.permissions?.canUpdate ||
                  processingSavingStageCode === stage.stageCode
                }
              >
                Culminar Recepcion
              </button>
            </div>
          </section>
        ) : null}

        {stage.stageCode === "preworks" ? (
          <section className="processing-products-box">
            <header>
              <h6>Items de ordenes de compra</h6>
              <p>
                Productos y servicios generados en las ordenes de compra, con su
                estado de recepcion.
              </p>
            </header>

            {receptionPurchaseOrders.some(
              (order) => Array.isArray(order?.lines) && order.lines.length,
            ) ? (
              <div className="processing-products-table-wrap">
                <table className="processing-products-table">
                  <thead>
                    <tr>
                      <th>Orden</th>
                      <th>Proveedor</th>
                      <th>Codigo</th>
                      <th>Producto o servicio</th>
                      <th className="is-right">Cantidad</th>
                      <th className="is-center">Recibido</th>
                      <th>Fecha de recepcion</th>
                      <th className="is-center">Preworks</th>
                      <th>Fecha de preworks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receptionPurchaseOrders.flatMap((order, orderIndex) =>
                      (Array.isArray(order?.lines) ? order.lines : []).map(
                        (line, lineIndex) => {
                          const receptionItemKey = `${order?.orderId || orderIndex}:${line?.productId || line?.code || lineIndex}:${lineIndex}`;
                          const receptionItem =
                            receptionItems[receptionItemKey] || {};
                          const preworksItem =
                            preworksItems[receptionItemKey] || {};
                          const updatePreworksItem = (patch) =>
                            updateActiveStageDataField("preworksItems", {
                              ...preworksItems,
                              [receptionItemKey]: {
                                ...preworksItem,
                                ...patch,
                              },
                            });

                          return (
                            <tr key={`preworks-${receptionItemKey}`}>
                              <td>{order?.orderNumber || "-"}</td>
                              <td>{order?.providerName || "Proveedor"}</td>
                              <td>{line?.code || "-"}</td>
                              <td>{line?.description || "Sin descripcion"}</td>
                              <td className="is-right">
                                {Number(line?.quantity || 0).toLocaleString(
                                  "es-MX",
                                  { maximumFractionDigits: 4 },
                                )}
                              </td>
                              <td className="is-center">
                                <input
                                  type="checkbox"
                                  checked={Boolean(receptionItem.received)}
                                  readOnly
                                  disabled
                                  aria-label={`${line?.description || line?.code || "Item"} recibido`}
                                />
                              </td>
                              <td>{formatDate(receptionItem.receptionDate)}</td>
                              <td className="is-center">
                                <input
                                  type="checkbox"
                                  checked={Boolean(preworksItem.completed)}
                                  onChange={(event) =>
                                    updatePreworksItem({
                                      completed: event.target.checked,
                                    })
                                  }
                                  disabled={
                                    !processingData.permissions?.canUpdate
                                  }
                                  aria-label={`Marcar preworks de ${line?.description || line?.code || "item"}`}
                                />
                              </td>
                              <td>
                                <DatePicker
                                  selected={parseDateInputValue(
                                    preworksItem.preworksDate,
                                  )}
                                  onChange={(date) =>
                                    updatePreworksItem({
                                      preworksDate: formatDatePickerValue(date),
                                    })
                                  }
                                  dateFormat="dd-MM-yyyy"
                                  locale={es}
                                  showMonthDropdown
                                  showYearDropdown
                                  dropdownMode="select"
                                  fixedHeight
                                  calendarClassName="audit-datepicker-calendar processing-date-calendar"
                                  popperClassName="audit-datepicker-popper"
                                  className="processing-date-input"
                                  dayClassName={(date) =>
                                    formatDatePickerValue(date) ===
                                    getTodayBusinessDate()
                                      ? "processing-date-business-today"
                                      : undefined
                                  }
                                  autoComplete="off"
                                  showPopperArrow={false}
                                  disabled={
                                    !processingData.permissions?.canUpdate
                                  }
                                  placeholderText="Seleccionar fecha"
                                />
                              </td>
                            </tr>
                          );
                        },
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="field-hint">
                Aun no hay items en las ordenes de compra generadas.
              </p>
            )}

            <div className="processing-stage-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void saveProcessingStage(stage.stageCode)}
                disabled={
                  !processingData.permissions?.canUpdate ||
                  processingSavingStageCode === stage.stageCode
                }
              >
                {processingSavingStageCode === stage.stageCode
                  ? "Guardando..."
                  : "Guardar preworks"}
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() =>
                  void saveProcessingStage(stage.stageCode, {
                    forceStatus: "completed",
                    forceCompletedAt: new Date().toISOString(),
                  })
                }
                disabled={
                  !processingData.permissions?.canUpdate ||
                  processingSavingStageCode === stage.stageCode
                }
              >
                Culminar Preworks
              </button>
            </div>
          </section>
        ) : null}

        {stage.stageCode === "products_delivery" ? (
          <section className="processing-products-box">
            <header>
              <h6>Items del pedido</h6>
              <p>
                Productos y servicios incluidos en las ordenes de compra del
                pedido.
              </p>
            </header>

            {receptionPurchaseOrders.length ? (
              <div className="processing-reception-orders">
                {receptionPurchaseOrders.map((order, orderIndex) => {
                  const orderLines = Array.isArray(order?.lines)
                    ? order.lines
                    : [];
                  const deliveryOrderKey = String(order?.orderId || order?.orderNumber || orderIndex);
                  const deliveryItemExtras = Array.isArray(
                    productsDeliveryStage?.stageData?.deliveryItemExtras,
                  )
                    ? productsDeliveryStage.stageData.deliveryItemExtras
                    : [];
                  const orderDeliveryExtras = deliveryItemExtras.filter(
                    (e) => String(e.orderId || "") === deliveryOrderKey,
                  );

                  return (
                    <article
                      key={deliveryOrderKey}
                      className="processing-reception-order"
                    >
                      <header className="processing-reception-order-header">
                        <div>
                          <h6>{order?.orderNumber || "Orden de compra"}</h6>
                          <p>{order?.providerName || "Proveedor"}</p>
                        </div>
                        <span>{formatDate(order?.orderDate)}</span>
                      </header>

                      {orderLines.length ? (
                        <div className="processing-products-table-wrap">
                          <table className="processing-products-table">
                            <thead>
                              <tr>
                                <th>Codigo</th>
                                <th>Producto o servicio</th>
                                <th className="is-right">Cantidad</th>
                                <th className="is-center">Entregado</th>
                                <th>Fecha de entrega</th>
                                <th className="is-center">Acciones</th>
                              </tr>
                            </thead>
                            <tbody>
                              {orderLines.map((line, lineIndex) => {
                                const itemKey = `${deliveryOrderKey}:${line?.productId || line?.code || lineIndex}:${lineIndex}`;
                                const deliveryItem =
                                  deliveryItems[itemKey] || {};
                                const effectiveQty =
                                  deliveryItem.quantityOverride != null
                                    ? deliveryItem.quantityOverride
                                    : Number(line?.quantity || 0);
                                const updateDeliveryItem = (patch) =>
                                  updateActiveStageDataField("deliveryItems", {
                                    ...deliveryItems,
                                    [itemKey]: {
                                      ...deliveryItem,
                                      ...patch,
                                    },
                                  });

                                return (
                                  <tr key={`delivery-${itemKey}`}>
                                    <td>{line?.code || "-"}</td>
                                    <td>
                                      {line?.description || "Sin descripcion"}
                                    </td>
                                    <td className="is-right">
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.0001"
                                        value={String(effectiveQty)}
                                        onChange={(e) =>
                                          updateDeliveryItem({
                                            quantityOverride: e.target.value === "" ? null : Number(e.target.value),
                                          })
                                        }
                                        disabled={!processingData.permissions?.canUpdate}
                                        style={{ width: 80, textAlign: "right" }}
                                      />
                                    </td>
                                    <td className="is-center">
                                      <input
                                        type="checkbox"
                                        checked={Boolean(
                                          deliveryItem.delivered,
                                        )}
                                        onChange={(event) =>
                                          updateDeliveryItem({
                                            delivered: event.target.checked,
                                          })
                                        }
                                        disabled={
                                          !processingData.permissions?.canUpdate
                                        }
                                        aria-label={`Marcar ${line?.description || line?.code || "item"} como entregado`}
                                      />
                                    </td>
                                    <td>
                                      <DatePicker
                                        selected={parseDateInputValue(
                                          deliveryItem.deliveryDate,
                                        )}
                                        onChange={(date) =>
                                          updateDeliveryItem({
                                            deliveryDate:
                                              formatDatePickerValue(date),
                                          })
                                        }
                                        dateFormat="dd-MM-yyyy"
                                        locale={es}
                                        showMonthDropdown
                                        showYearDropdown
                                        dropdownMode="select"
                                        fixedHeight
                                        calendarClassName="audit-datepicker-calendar processing-date-calendar"
                                        popperClassName="audit-datepicker-popper"
                                        className="processing-date-input"
                                        dayClassName={(date) =>
                                          formatDatePickerValue(date) ===
                                          getTodayBusinessDate()
                                            ? "processing-date-business-today"
                                            : undefined
                                        }
                                        autoComplete="off"
                                        showPopperArrow={false}
                                        disabled={
                                          !processingData.permissions?.canUpdate
                                        }
                                        placeholderText="Seleccionar fecha"
                                      />
                                    </td>
                                    <td className="is-center">
                                      <button
                                        type="button"
                                        className="btn-secondary processing-product-action-icon"
                                        title="Duplicar item"
                                        aria-label={`Duplicar ${line?.description || line?.code || "item"}`}
                                        disabled={!processingData.permissions?.canUpdate}
                                        onClick={() => {
                                          const nextExtras = [
                                            ...deliveryItemExtras,
                                            {
                                              id: `dup-${Date.now()}-${Math.round(Math.random() * 9999)}`,
                                              orderId: deliveryOrderKey,
                                              code: line?.code || "-",
                                              description: line?.description || "Sin descripcion",
                                              quantityOverride: Number(effectiveQty),
                                              delivered: false,
                                              deliveryDate: "",
                                            },
                                          ];
                                          patchProcessingStage("products_delivery", {
                                            stageData: { deliveryItemExtras: nextExtras },
                                          });
                                        }}
                                      >
                                        <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                                          <path d="M8 4.75A2.75 2.75 0 0 0 5.25 7.5v8A2.75 2.75 0 0 0 8 18.25h8a2.75 2.75 0 0 0 2.75-2.75v-8A2.75 2.75 0 0 0 16 4.75zm0 1.5h8c.69 0 1.25.56 1.25 1.25v8c0 .69-.56 1.25-1.25 1.25H8c-.69 0-1.25-.56-1.25-1.25v-8c0-.69.56-1.25 1.25-1.25" />
                                          <path d="M4 8.5a.75.75 0 0 1 .75.75v8c0 .69.56 1.25 1.25 1.25h8a.75.75 0 0 1 0 1.5H6A2.75 2.75 0 0 1 3.25 17.25v-8A.75.75 0 0 1 4 8.5" />
                                        </svg>
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                              {orderDeliveryExtras.map((extra) => (
                                <tr key={extra.id} style={{ background: "#f8faff" }}>
                                  <td style={{ color: "#64748b", fontStyle: "italic" }}>{extra.code}</td>
                                  <td style={{ color: "#64748b", fontStyle: "italic" }}>{extra.description}</td>
                                  <td className="is-right">
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.0001"
                                      value={String(extra.quantityOverride ?? 0)}
                                      onChange={(e) => {
                                        const nextExtras = deliveryItemExtras.map((ex) =>
                                          ex.id === extra.id
                                            ? { ...ex, quantityOverride: e.target.value === "" ? 0 : Number(e.target.value) }
                                            : ex,
                                        );
                                        patchProcessingStage("products_delivery", {
                                          stageData: { deliveryItemExtras: nextExtras },
                                        });
                                      }}
                                      disabled={!processingData.permissions?.canUpdate}
                                      style={{ width: 80, textAlign: "right" }}
                                    />
                                  </td>
                                  <td className="is-center">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(extra.delivered)}
                                      onChange={(e) => {
                                        const nextExtras = deliveryItemExtras.map((ex) =>
                                          ex.id === extra.id ? { ...ex, delivered: e.target.checked } : ex,
                                        );
                                        patchProcessingStage("products_delivery", {
                                          stageData: { deliveryItemExtras: nextExtras },
                                        });
                                      }}
                                      disabled={!processingData.permissions?.canUpdate}
                                    />
                                  </td>
                                  <td>
                                    <DatePicker
                                      selected={parseDateInputValue(extra.deliveryDate)}
                                      onChange={(date) => {
                                        const nextExtras = deliveryItemExtras.map((ex) =>
                                          ex.id === extra.id ? { ...ex, deliveryDate: formatDatePickerValue(date) } : ex,
                                        );
                                        patchProcessingStage("products_delivery", {
                                          stageData: { deliveryItemExtras: nextExtras },
                                        });
                                      }}
                                      dateFormat="dd-MM-yyyy"
                                      locale={es}
                                      showMonthDropdown
                                      showYearDropdown
                                      dropdownMode="select"
                                      fixedHeight
                                      calendarClassName="audit-datepicker-calendar processing-date-calendar"
                                      popperClassName="audit-datepicker-popper"
                                      className="processing-date-input"
                                      autoComplete="off"
                                      showPopperArrow={false}
                                      disabled={!processingData.permissions?.canUpdate}
                                      placeholderText="Seleccionar fecha"
                                    />
                                  </td>
                                  <td className="is-center">
                                    <button
                                      type="button"
                                      className="btn-secondary processing-product-action-icon is-danger"
                                      title="Eliminar copia"
                                      aria-label="Eliminar item duplicado"
                                      disabled={!processingData.permissions?.canUpdate}
                                      onClick={() => {
                                        patchProcessingStage("products_delivery", {
                                          stageData: {
                                            deliveryItemExtras: deliveryItemExtras.filter((ex) => ex.id !== extra.id),
                                          },
                                        });
                                      }}
                                    >
                                      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                                        <path d="M9.25 4a.75.75 0 0 1 .75-.75h4a.75.75 0 0 1 .75.75V5h3a.75.75 0 0 1 0 1.5h-.76l-.63 11.01A2.75 2.75 0 0 1 14.37 20h-4.74a2.75 2.75 0 0 1-2.74-2.49L6.26 6.5H5.5a.75.75 0 0 1 0-1.5h3zm1.5.75V5h2.5v-.25zM7.76 6.5l.62 10.92c.04.66.58 1.18 1.25 1.18h4.74c.67 0 1.21-.52 1.25-1.18l.62-10.92z" />
                                        <path d="M10.75 9a.75.75 0 0 1 .75.75v5a.75.75 0 0 1-1.5 0v-5a.75.75 0 0 1 .75-.75m2.5 0a.75.75 0 0 1 .75.75v5a.75.75 0 0 1-1.5 0v-5a.75.75 0 0 1 .75-.75" />
                                      </svg>
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="field-hint">
                          Esta orden no tiene productos o servicios.
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="field-hint">
                Aun no hay items en las ordenes de compra generadas.
              </p>
            )}

            <div className="processing-stage-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void saveProcessingStage(stage.stageCode)}
                disabled={
                  !processingData.permissions?.canUpdate ||
                  processingSavingStageCode === stage.stageCode
                }
              >
                {processingSavingStageCode === stage.stageCode
                  ? "Guardando..."
                  : "Guardar entrega"}
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() =>
                  void saveProcessingStage(stage.stageCode, {
                    forceStatus: "completed",
                    forceCompletedAt: new Date().toISOString(),
                  })
                }
                disabled={
                  !processingData.permissions?.canUpdate ||
                  processingSavingStageCode === stage.stageCode
                }
              >
                Culminar Entrega de Productos
              </button>
            </div>
          </section>
        ) : null}

        {stage.stageCode === "provider_purchase_order" ? (
          <section className="processing-products-box">
            <header>
              <h6>Productos</h6>
              <p>
                Items de la cotizacion con costo unitario considerando
                descuentos.
              </p>
            </header>

            {providerPurchaseOrderRows.length ? (
              <div className="processing-products-table-wrap">
                <table className="processing-products-table">
                  <thead>
                    <tr>
                      <th>Sel.</th>
                      <th>Codigo</th>
                      <th>Descripcion</th>
                      <th>Proveedor</th>
                      <th className="is-right">Cantidad</th>
                      <th className="is-right">Costo unitario</th>
                      <th>Fecha</th>
                      <th>Tiempo restante</th>
                      <th className="is-right">Costo total</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {providerPurchaseOrderRows.map((item) => {
                      const itemKey = String(
                        item.assignmentKey || item.id || "",
                      );
                      const assignment =
                        (itemKey && rawProductAssignments[itemKey]) || {};
                      const selected = Boolean(assignment?.selected);
                      const quantityInputValue =
                        assignment?.quantity == null ||
                        assignment?.quantity === ""
                          ? String(Number(item.quantity || 0))
                          : String(assignment.quantity);
                      const unitCostInputValue =
                        assignment?.unitCostWithDiscount == null ||
                        assignment?.unitCostWithDiscount === ""
                          ? String(Number(item.unitCostWithDiscount || 0))
                          : String(assignment.unitCostWithDiscount);
                      const selectionDateInputValue =
                        toDateInputValue(assignment?.selectionDate) ||
                        toDateInputValue(item.selectionDate) ||
                        toDateInputValue(new Date());
                      const remainingDays = calculateRemainingDays(
                        selectionDateInputValue,
                      );
                      const effectiveQuantity = Number(quantityInputValue || 0);
                      const effectiveUnitCost = Number(unitCostInputValue || 0);
                      const effectiveTotalCost =
                        Number.isFinite(effectiveQuantity) &&
                        Number.isFinite(effectiveUnitCost)
                          ? effectiveQuantity * effectiveUnitCost
                          : 0;
                      const selectedProviderId =
                        assignment?.providerId == null ||
                        assignment?.providerId === ""
                          ? item.providerId || ""
                          : Number(assignment.providerId || 0) || "";
                      const isGeneratedItem = generatedAssignmentKeys.has(
                        itemKey,
                      );
                      const isEditingQuantity =
                        !isGeneratedItem &&
                        editingProductCell?.itemKey === itemKey &&
                        editingProductCell?.field === "quantity";
                      const isEditingUnitCost =
                        !isGeneratedItem &&
                        editingProductCell?.itemKey === itemKey &&
                        editingProductCell?.field === "unitCostWithDiscount";

                      return (
                        <tr
                          key={itemKey}
                          className={
                            isGeneratedItem
                              ? "processing-product-row-generated"
                              : ""
                          }
                        >
                          <td>
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={(event) => {
                                const nextAssignments = {
                                  ...rawProductAssignments,
                                  [itemKey]: {
                                    ...assignment,
                                    selected: event.target.checked,
                                    providerId:
                                      selectedProviderId === ""
                                        ? null
                                        : Number(selectedProviderId),
                                  },
                                };
                                updateStageProductAssignmentState(
                                  stage.stageCode,
                                  nextAssignments,
                                  rawProductAssignmentDuplicates,
                                  rawProductAssignmentExtras,
                                );
                              }}
                              disabled={
                                isGeneratedItem ||
                                !processingData.permissions?.canUpdate
                              }
                            />
                          </td>
                          <td>
                            {item.isCustom ? (
                              <input
                                type="text"
                                className="processing-custom-code-trigger"
                                value={item.code || ""}
                                readOnly
                                title="Doble clic para seleccionar item del catalogo"
                                onDoubleClick={(event) => {
                                  event.stopPropagation();
                                  openCustomStepItemPicker(
                                    stage.stageCode,
                                    itemKey,
                                    selectedProviderId,
                                  );
                                }}
                              />
                            ) : (
                              item.code || "-"
                            )}
                          </td>
                          <td>
                            {item.description || "Sin descripcion"}
                            {item.isDuplicate ? (
                              <span className="processing-item-copy-badge">
                                Copia
                              </span>
                            ) : null}
                          </td>
                          <td>
                            <select
                              value={selectedProviderId}
                              onChange={(event) => {
                                const providerValue = event.target.value;
                                const nextAssignments = {
                                  ...rawProductAssignments,
                                  [itemKey]: {
                                    ...assignment,
                                    selected,
                                    providerId: providerValue
                                      ? Number(providerValue)
                                      : null,
                                  },
                                };
                                updateStageProductAssignmentState(
                                  stage.stageCode,
                                  nextAssignments,
                                  rawProductAssignmentDuplicates,
                                  rawProductAssignmentExtras,
                                );
                              }}
                              disabled={
                                isGeneratedItem ||
                                !processingData.permissions?.canUpdate
                              }
                            >
                              <option value="">Sin proveedor</option>
                              {processingProviders.map((provider) => (
                                <option key={provider.id} value={provider.id}>
                                  {provider.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="is-right">
                            {isEditingQuantity ? (
                              <input
                                type="number"
                                step="0.0001"
                                min="0"
                                value={quantityInputValue}
                                onChange={(event) => {
                                  const nextAssignments = {
                                    ...rawProductAssignments,
                                    [itemKey]: {
                                      ...assignment,
                                      selected,
                                      providerId:
                                        selectedProviderId === ""
                                          ? null
                                          : Number(selectedProviderId),
                                      quantity: event.target.value,
                                    },
                                  };
                                  updateStageProductAssignmentState(
                                    stage.stageCode,
                                    nextAssignments,
                                    rawProductAssignmentDuplicates,
                                    rawProductAssignmentExtras,
                                  );
                                }}
                                onBlur={() => {
                                  const normalized = Math.max(
                                    0,
                                    Number(quantityInputValue || 0),
                                  );
                                  const nextAssignments = {
                                    ...rawProductAssignments,
                                    [itemKey]: {
                                      ...assignment,
                                      selected,
                                      providerId:
                                        selectedProviderId === ""
                                          ? null
                                          : Number(selectedProviderId),
                                      quantity: Number.isFinite(normalized)
                                        ? String(Number(normalized.toFixed(4)))
                                        : "0",
                                    },
                                  };
                                  updateStageProductAssignmentState(
                                    stage.stageCode,
                                    nextAssignments,
                                    rawProductAssignmentDuplicates,
                                    rawProductAssignmentExtras,
                                  );
                                  setEditingProductCell(null);
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.currentTarget.blur();
                                  }
                                  if (event.key === "Escape") {
                                    setEditingProductCell(null);
                                  }
                                }}
                                autoFocus
                                className="processing-inline-edit-input"
                                disabled={
                                  isGeneratedItem ||
                                  !processingData.permissions?.canUpdate
                                }
                              />
                            ) : (
                              <button
                                type="button"
                                className="processing-inline-edit-trigger"
                                onClick={() =>
                                  setEditingProductCell({
                                    itemKey,
                                    field: "quantity",
                                  })
                                }
                                disabled={
                                  isGeneratedItem ||
                                  !processingData.permissions?.canUpdate
                                }
                              >
                                {Number(effectiveQuantity || 0).toLocaleString(
                                  "es-MX",
                                  {
                                    maximumFractionDigits: 4,
                                  },
                                )}
                              </button>
                            )}
                          </td>
                          <td className="is-right">
                            {isEditingUnitCost ? (
                              <input
                                type="number"
                                step="0.0001"
                                min="0"
                                value={unitCostInputValue}
                                onChange={(event) => {
                                  const nextAssignments = {
                                    ...rawProductAssignments,
                                    [itemKey]: {
                                      ...assignment,
                                      selected,
                                      providerId:
                                        selectedProviderId === ""
                                          ? null
                                          : Number(selectedProviderId),
                                      unitCostWithDiscount: event.target.value,
                                    },
                                  };
                                  updateStageProductAssignmentState(
                                    stage.stageCode,
                                    nextAssignments,
                                    rawProductAssignmentDuplicates,
                                    rawProductAssignmentExtras,
                                  );
                                }}
                                onBlur={() => {
                                  const normalized = Math.max(
                                    0,
                                    Number(unitCostInputValue || 0),
                                  );
                                  const nextAssignments = {
                                    ...rawProductAssignments,
                                    [itemKey]: {
                                      ...assignment,
                                      selected,
                                      providerId:
                                        selectedProviderId === ""
                                          ? null
                                          : Number(selectedProviderId),
                                      unitCostWithDiscount: Number.isFinite(
                                        normalized,
                                      )
                                        ? String(Number(normalized.toFixed(4)))
                                        : "0",
                                    },
                                  };
                                  updateStageProductAssignmentState(
                                    stage.stageCode,
                                    nextAssignments,
                                    rawProductAssignmentDuplicates,
                                    rawProductAssignmentExtras,
                                  );
                                  setEditingProductCell(null);
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.currentTarget.blur();
                                  }
                                  if (event.key === "Escape") {
                                    setEditingProductCell(null);
                                  }
                                }}
                                autoFocus
                                className="processing-inline-edit-input"
                                disabled={
                                  isGeneratedItem ||
                                  !processingData.permissions?.canUpdate
                                }
                              />
                            ) : (
                              <button
                                type="button"
                                className="processing-inline-edit-trigger"
                                onClick={() =>
                                  setEditingProductCell({
                                    itemKey,
                                    field: "unitCostWithDiscount",
                                  })
                                }
                                disabled={
                                  isGeneratedItem ||
                                  !processingData.permissions?.canUpdate
                                }
                              >
                                {formatCurrency(
                                  Number(effectiveUnitCost || 0),
                                  item.currencyCode || processingCurrencyCode,
                                )}
                              </button>
                            )}
                          </td>
                          <td>
                            <DatePicker
                              selected={parseDateInputValue(
                                selectionDateInputValue,
                              )}
                              onChange={(date) => {
                                const nextAssignments = {
                                  ...rawProductAssignments,
                                  [itemKey]: {
                                    ...assignment,
                                    selected,
                                    providerId:
                                      selectedProviderId === ""
                                        ? null
                                        : Number(selectedProviderId),
                                    selectionDate: formatDatePickerValue(date),
                                  },
                                };
                                updateStageProductAssignmentState(
                                  stage.stageCode,
                                  nextAssignments,
                                  rawProductAssignmentDuplicates,
                                  rawProductAssignmentExtras,
                                );
                              }}
                              dateFormat="dd-MM-yyyy"
                              locale={es}
                              showMonthDropdown
                              showYearDropdown
                              dropdownMode="select"
                              fixedHeight
                              calendarClassName="audit-datepicker-calendar processing-date-calendar"
                              popperClassName="audit-datepicker-popper"
                              className="processing-date-input"
                              dayClassName={(date) =>
                                formatDatePickerValue(date) ===
                                getTodayBusinessDate()
                                  ? "processing-date-business-today"
                                  : undefined
                              }
                              autoComplete="off"
                              showPopperArrow={false}
                              disabled={
                                isGeneratedItem ||
                                !processingData.permissions?.canUpdate
                              }
                            />
                          </td>
                          <td
                            className={`processing-remaining-days${
                              remainingDays < 0 ? " is-negative" : ""
                            }`}
                          >
                            {remainingDays}
                          </td>
                          <td className="is-right">
                            {formatCurrency(
                              Number(effectiveTotalCost || 0),
                              item.currencyCode || processingCurrencyCode,
                            )}
                          </td>
                          <td>
                            <div className="processing-product-actions">
                              <button
                                type="button"
                                className="btn-secondary processing-product-action-icon"
                                aria-label="Duplicar item"
                                title="Duplicar item"
                                onClick={() => {
                                  const sourceProductId = Number(
                                    item.sourceProductId || item.id || 0,
                                  );
                                  if (
                                    !Number.isInteger(sourceProductId) ||
                                    sourceProductId <= 0
                                  ) {
                                    return;
                                  }
                                  const duplicateKey = `dup-${sourceProductId}-${Date.now()}`;
                                  const nextAssignments = {
                                    ...rawProductAssignments,
                                    [duplicateKey]: {
                                      selected,
                                      providerId:
                                        selectedProviderId === ""
                                          ? null
                                          : Number(selectedProviderId),
                                      quantity: quantityInputValue,
                                      unitCostWithDiscount: unitCostInputValue,
                                      selectionDate: selectionDateInputValue,
                                      sourceProductId: Number(
                                        item.sourceProductId || item.id || 0,
                                      ),
                                    },
                                  };
                                  const nextDuplicates = {
                                    ...rawProductAssignmentDuplicates,
                                    [duplicateKey]: {
                                      sourceProductId,
                                      createdAt: Date.now(),
                                    },
                                  };
                                  updateStageProductAssignmentState(
                                    stage.stageCode,
                                    nextAssignments,
                                    nextDuplicates,
                                    rawProductAssignmentExtras,
                                  );
                                }}
                                disabled={
                                  isGeneratedItem ||
                                  !processingData.permissions?.canUpdate ||
                                  !Number.isInteger(
                                    Number(item.sourceProductId || 0),
                                  ) ||
                                  Number(item.sourceProductId || 0) <= 0
                                }
                              >
                                <svg
                                  viewBox="0 0 24 24"
                                  focusable="false"
                                  aria-hidden="true"
                                >
                                  <path d="M8 4.75A2.75 2.75 0 0 0 5.25 7.5v8A2.75 2.75 0 0 0 8 18.25h8a2.75 2.75 0 0 0 2.75-2.75v-8A2.75 2.75 0 0 0 16 4.75zm0 1.5h8c.69 0 1.25.56 1.25 1.25v8c0 .69-.56 1.25-1.25 1.25H8c-.69 0-1.25-.56-1.25-1.25v-8c0-.69.56-1.25 1.25-1.25" />
                                  <path d="M4 8.5a.75.75 0 0 1 .75.75v8c0 .69.56 1.25 1.25 1.25h8a.75.75 0 0 1 0 1.5H6A2.75 2.75 0 0 1 3.25 17.25v-8A.75.75 0 0 1 4 8.5" />
                                </svg>
                              </button>
                              {item.isDuplicate || item.isCustom ? (
                                <button
                                  type="button"
                                  className="btn-secondary processing-product-action-icon is-danger"
                                  aria-label={
                                    item.isCustom
                                      ? "Eliminar item"
                                      : "Eliminar copia"
                                  }
                                  title={
                                    item.isCustom
                                      ? "Eliminar item"
                                      : "Eliminar copia"
                                  }
                                  onClick={() => {
                                    const nextAssignments = {
                                      ...rawProductAssignments,
                                    };
                                    const nextDuplicates = {
                                      ...rawProductAssignmentDuplicates,
                                    };
                                    const nextExtras = {
                                      ...rawProductAssignmentExtras,
                                    };
                                    delete nextAssignments[itemKey];
                                    delete nextDuplicates[itemKey];
                                    delete nextExtras[itemKey];
                                    updateStageProductAssignmentState(
                                      stage.stageCode,
                                      nextAssignments,
                                      nextDuplicates,
                                      nextExtras,
                                    );
                                    if (
                                      editingProductCell?.itemKey === itemKey
                                    ) {
                                      setEditingProductCell(null);
                                    }
                                  }}
                                  disabled={
                                    !processingData.permissions?.canUpdate
                                  }
                                >
                                  <svg
                                    viewBox="0 0 24 24"
                                    focusable="false"
                                    aria-hidden="true"
                                  >
                                    <path d="M9.25 4a.75.75 0 0 1 .75-.75h4a.75.75 0 0 1 .75.75V5h3a.75.75 0 0 1 0 1.5h-.76l-.63 11.01A2.75 2.75 0 0 1 14.37 20h-4.74a2.75 2.75 0 0 1-2.74-2.49L6.26 6.5H5.5a.75.75 0 0 1 0-1.5h3zm1.5.75V5h2.5v-.25zM7.76 6.5l.62 10.92c.04.66.58 1.18 1.25 1.18h4.74c.67 0 1.21-.52 1.25-1.18l.62-10.92z" />
                                    <path d="M10.75 9a.75.75 0 0 1 .75.75v5a.75.75 0 0 1-1.5 0v-5a.75.75 0 0 1 .75-.75m2.5 0a.75.75 0 0 1 .75.75v5a.75.75 0 0 1-1.5 0v-5a.75.75 0 0 1 .75-.75" />
                                  </svg>
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th colSpan={8} className="is-right">
                        Costo total
                      </th>
                      <th className="is-right">
                        {formatCurrency(
                          providerPurchaseOrderTotalCost,
                          providerPurchaseOrderRows[0]?.currencyCode ||
                            processingCurrencyCode,
                        )}
                      </th>
                      <th aria-label="Acciones" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <p className="field-hint">
                No hay items disponibles en la cotizacion para mostrar en este
                step.
              </p>
            )}

            <section className="processing-stage-box" style={{ marginTop: 16 }}>
              <header>
                <h5>Datos de orden de compra</h5>
              </header>
              <div className="processing-stage-grid two">
                <label className="field-group processing-stage-field">
                  <span>Proveedor</span>
                  <input
                    type="text"
                    value={
                      selectedProvider?.name ||
                      (selectedProviderIds.size > 1
                        ? "Seleccion multiple de proveedores"
                        : hasSelectedLinesWithoutProvider
                          ? "Hay items sin proveedor"
                          : "Selecciona items de un proveedor")
                    }
                    readOnly
                    disabled
                  />
                </label>

                <label className="field-group processing-stage-field">
                  <span>Contacto del proveedor</span>
                  <select
                    value={selectedProviderContactId}
                    onChange={(event) =>
                      updateActiveStageDataField(
                        "providerContactId",
                        event.target.value ? Number(event.target.value) : null,
                      )
                    }
                    disabled={
                      !selectedProvider ||
                      !processingData.permissions?.canUpdate
                    }
                  >
                    <option value="">
                      {selectedProvider
                        ? selectedProviderContacts.length
                          ? "Selecciona contacto"
                          : "Proveedor sin contactos"
                        : "Selecciona un proveedor"}
                    </option>
                    {selectedProviderContacts.map((contact) => {
                      const fullName = [contact.firstName, contact.lastName]
                        .filter(Boolean)
                        .join(" ");
                      return (
                        <option key={contact.id} value={contact.id}>
                          {fullName ||
                            contact.email ||
                            `Contacto #${contact.id}`}
                          {fullName && contact.email
                            ? ` (${contact.email})`
                            : ""}
                        </option>
                      );
                    })}
                  </select>
                </label>

                <label className="field-group processing-stage-field">
                  <span>Cliente final</span>
                  <input
                    type="text"
                    value={quotationToProcess?.accountName || "-"}
                    readOnly
                    disabled
                  />
                </label>

                <label className="field-group processing-stage-field">
                  <span>Cotizacion del proveedor</span>
                  <input
                    type="text"
                    value={stage?.stageData?.providerQuotation || ""}
                    placeholder="Ingresa la cotizacion del proveedor"
                    onChange={(event) =>
                      updateActiveStageDataField(
                        "providerQuotation",
                        event.target.value,
                      )
                    }
                    disabled={!processingData.permissions?.canUpdate}
                  />
                </label>

                <label className="field-group processing-stage-field full">
                  <span>Condiciones de pago</span>
                  <input
                    type="text"
                    value={
                      stage?.stageData?.purchaseOrderPaymentConditions ??
                      paymentTermsName
                    }
                    placeholder="Ingresa las condiciones de pago"
                    onChange={(event) =>
                      updateActiveStageDataField(
                        "purchaseOrderPaymentConditions",
                        event.target.value,
                      )
                    }
                    disabled={!processingData.permissions?.canUpdate}
                  />
                </label>

                {quotationCommercialFields.map((field) => (
                  <label
                    key={field.key}
                    className="field-group processing-stage-field"
                  >
                    <span>{field.label}</span>
                    <input
                      type="text"
                      value={field.value || "-"}
                      readOnly
                      disabled
                    />
                  </label>
                ))}

                <label className="field-group processing-stage-field full">
                  <span>Notas</span>
                  <textarea
                    rows={8}
                    value={
                      stage?.stageData?.purchaseOrderNotes ??
                      DEFAULT_PURCHASE_ORDER_NOTES
                    }
                    onChange={(event) =>
                      updateActiveStageDataField(
                        "purchaseOrderNotes",
                        event.target.value,
                      )
                    }
                    disabled={!processingData.permissions?.canUpdate}
                  />
                </label>
              </div>
            </section>

            <section className="processing-products-box">
              <header>
                <h6>Ordenes generadas</h6>
                <p>
                  Listado de ordenes de compra ya generadas para este pedido.
                </p>
              </header>

              {generatedPurchaseOrders.length ? (
                <div className="processing-products-table-wrap">
                  <table className="processing-products-table">
                    <thead>
                      <tr>
                        <th>Numero de orden</th>
                        <th>Proveedor</th>
                        <th>Fecha</th>
                        <th className="is-right">Sin IVA</th>
                        <th className="is-right">Total</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {generatedPurchaseOrders.map((order, index) => (
                        <tr
                          key={
                            order.orderId ||
                            `${order.providerId || "provider"}-${index}`
                          }
                        >
                          <td>{order.orderNumber || "-"}</td>
                          <td>{order.providerName || "Proveedor"}</td>
                          <td>{formatDate(order.orderDate)}</td>
                          <td className="is-right">
                            {formatCurrency(
                              Number(order.subtotal || 0),
                              order.currencyCode || processingCurrencyCode,
                            )}
                          </td>
                          <td className="is-right">
                            {formatCurrency(
                              Number(order.total || 0),
                              order.currencyCode || processingCurrencyCode,
                            )}
                          </td>
                          <td>
                            <div className="processing-product-actions">
                              <button
                                type="button"
                                className="btn-secondary processing-product-action-icon"
                                aria-label={`Ver orden ${order.orderNumber || order.orderId}`}
                                title="Ver orden"
                                onClick={() =>
                                  openGeneratedPurchaseOrderPreview(
                                    order,
                                    stage,
                                  )
                                }
                              >
                                <svg
                                  viewBox="0 0 24 24"
                                  focusable="false"
                                  aria-hidden="true"
                                >
                                  <path d="M12 5c5.3 0 8.7 4.7 9.4 5.8a2.2 2.2 0 0 1 0 2.4C20.7 14.3 17.3 19 12 19s-8.7-4.7-9.4-5.8a2.2 2.2 0 0 1 0-2.4C3.3 9.7 6.7 5 12 5m0 1.5c-4.5 0-7.5 4.1-8.1 5.1a.7.7 0 0 0 0 .8c.6 1 3.6 5.1 8.1 5.1s7.5-4.1 8.1-5.1a.7.7 0 0 0 0-.8c-.6-1-3.6-5.1-8.1-5.1m0 2.25A3.25 3.25 0 1 1 12 15.25 3.25 3.25 0 0 1 12 8.75m0 1.5A1.75 1.75 0 1 0 12 13.75 1.75 1.75 0 0 0 12 10.25" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                className="btn-secondary processing-product-action-icon is-danger"
                                aria-label={`Eliminar orden ${order.orderNumber || order.orderId}`}
                                title={
                                  deletingPurchaseOrderIds.has(
                                    Number(order.orderId),
                                  )
                                    ? "Eliminando orden"
                                    : "Eliminar orden"
                                }
                                onClick={() =>
                                  deleteGeneratedPurchaseOrder(order)
                                }
                                disabled={
                                  !processingData.permissions?.canUpdate ||
                                  deletingPurchaseOrderIds.has(
                                    Number(order.orderId),
                                  )
                                }
                              >
                                <svg
                                  viewBox="0 0 24 24"
                                  focusable="false"
                                  aria-hidden="true"
                                >
                                  <path d="M9.25 4a.75.75 0 0 1 .75-.75h4a.75.75 0 0 1 .75.75V5h3a.75.75 0 0 1 0 1.5h-.76l-.63 11.01A2.75 2.75 0 0 1 14.37 20h-4.74a2.75 2.75 0 0 1-2.74-2.49L6.26 6.5H5.5a.75.75 0 0 1 0-1.5h3zm1.5.75V5h2.5v-.25zM7.76 6.5l.62 10.92c.04.66.58 1.18 1.25 1.18h4.74c.67 0 1.21-.52 1.25-1.18l.62-10.92z" />
                                  <path d="M10.75 9a.75.75 0 0 1 .75.75v5a.75.75 0 0 1-1.5 0v-5a.75.75 0 0 1 .75-.75m2.5 0a.75.75 0 0 1 .75.75v5a.75.75 0 0 1-1.5 0v-5a.75.75 0 0 1 .75-.75" />
                                </svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th colSpan={3} className="is-right">
                          Total de ordenes
                        </th>
                        <th className="is-right">
                          {formatCurrency(
                            generatedPurchaseOrdersSubtotal,
                            generatedPurchaseOrders[0]?.currencyCode ||
                              processingCurrencyCode,
                          )}
                        </th>
                        <th className="is-right">
                          {formatCurrency(
                            generatedPurchaseOrdersTotal,
                            generatedPurchaseOrders[0]?.currencyCode ||
                              processingCurrencyCode,
                          )}
                        </th>
                        <th aria-label="Acciones" />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <p className="field-hint">Aun no hay ordenes generadas.</p>
              )}
            </section>

            <div className="processing-stage-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  const createdAt = Date.now();
                  const nextIndex =
                    Object.keys(rawProductAssignmentExtras).length + 1;
                  const extraKey = `extra-${createdAt}`;
                  const nextAssignments = {
                    ...rawProductAssignments,
                    [extraKey]: {
                      selected: true,
                      providerId: null,
                      quantity: "1",
                      unitCostWithDiscount: "0",
                      selectionDate: toDateInputValue(new Date()),
                    },
                  };
                  const nextExtras = {
                    ...rawProductAssignmentExtras,
                    [extraKey]: {
                      createdAt,
                      code: `ITEM-MANUAL-${nextIndex}`,
                      description: "Item agregado manualmente",
                      quantity: 1,
                      unitCostWithDiscount: 0,
                      selectionDate: toDateInputValue(new Date()),
                      currencyCode: processingCurrencyCode || "USD",
                    },
                  };
                  updateStageProductAssignmentState(
                    stage.stageCode,
                    nextAssignments,
                    rawProductAssignmentDuplicates,
                    nextExtras,
                  );
                }}
                disabled={!processingData.permissions?.canUpdate}
              >
                Anadir item
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void saveProcessingStage(stage.stageCode)}
                disabled={
                  !processingData.permissions?.canUpdate ||
                  processingSavingStageCode === stage.stageCode
                }
              >
                {processingSavingStageCode === stage.stageCode
                  ? "Guardando..."
                  : "Guardar"}
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() =>
                  openPurchaseOrderModal({
                    stage,
                    productAssignments: rawProductAssignments,
                    productAssignmentDuplicates: rawProductAssignmentDuplicates,
                    productAssignmentExtras: rawProductAssignmentExtras,
                    excludedAssignmentKeys: generatedAssignmentKeys,
                  })
                }
                disabled={!processingData.permissions?.canUpdate}
              >
                Vista previa
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() =>
                  void saveProcessingStage(stage.stageCode, {
                    forceStatus: "completed",
                    forceCompletedAt: new Date().toISOString(),
                  })
                }
                disabled={
                  !processingData.permissions?.canUpdate ||
                  processingSavingStageCode === stage.stageCode
                }
              >
                Culminar Orden de Compra
              </button>
            </div>
          </section>
        ) : null}
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
    processingStages.find(
      (stage) => stage.stageCode === activeProcessingStageCode,
    ) ||
    processingStages[0] ||
    null;
  const isQuotationAcceptedStage =
    activeProcessingStage?.stageCode === "quotation_accepted";
  const isKickoffInternalStage =
    activeProcessingStage?.stageCode === "kickoff_internal";
  const isKickoffExternalStage =
    activeProcessingStage?.stageCode === "kickoff_external";
  const isProviderPurchaseOrderStage =
    activeProcessingStage?.stageCode === "provider_purchase_order";
  const processingFinancials = quotationToProcess
    ? getQuotationFinancials(quotationToProcess)
    : getQuotationFinancials({});
  const processingCurrencyCode =
    quotationToProcess?.latestCurrencyCode || "USD";
  const processingUsers = Array.isArray(processingData?.assignableUsers)
    ? processingData.assignableUsers
    : [];
  const processingProviders = Array.isArray(processingData?.providers)
    ? processingData.providers
    : [];
  const kickoffInternalEvidences = Array.isArray(
    processingData?.kickoffInternal?.evidences,
  )
    ? processingData.kickoffInternal.evidences
    : [];
  const kickoffInternalGeneratedSummary = String(
    processingData?.kickoffInternal?.aiSummaryCurrent?.summary?.summary || "",
  ).trim();
  const kickoffInternalStageMinutesSummary =
    activeProcessingStage?.stageData?.minutesSummary;
  const kickoffInternalSummaryText = String(
    kickoffInternalStageMinutesSummary == null
      ? kickoffInternalGeneratedSummary
      : kickoffInternalStageMinutesSummary,
  );
  const kickoffExternalEvidences = Array.isArray(
    processingData?.kickoffExternal?.evidences,
  )
    ? processingData.kickoffExternal.evidences
    : [];
  const processingQuotationProducts = Array.isArray(
    processingData?.quotation?.products,
  )
    ? processingData.quotation.products
    : [];
  const purchaseOrderDraftOrders = Array.isArray(purchaseOrderDraft?.orders)
    ? purchaseOrderDraft.orders
    : [];
  const purchaseOrderProviderContact = Array.isArray(
    purchaseOrderDraft?.providerContacts,
  )
    ? purchaseOrderDraft.providerContacts.find(
        (contact) =>
          Number(contact.id) === Number(purchaseOrderDraft?.providerContactId),
      )
    : null;
  const purchaseOrderProviderContactName = purchaseOrderProviderContact
    ? [
        purchaseOrderProviderContact.firstName,
        purchaseOrderProviderContact.lastName,
      ]
        .filter(Boolean)
        .join(" ") ||
      purchaseOrderProviderContact.email ||
      ""
    : "";
  const purchaseOrderPrintModel =
    purchaseOrderFinalPreviewOpen &&
    Array.isArray(purchaseOrderPendingGeneratedOrders)
      ? buildPurchaseOrderPrintModel({
          quotation: quotationToProcess,
          orders: purchaseOrderPendingGeneratedOrders,
          currencyCode:
            purchaseOrderDraft?.currencyCode || processingCurrencyCode || "USD",
          providerQuotation: purchaseOrderDraft?.providerQuotation || "",
          providerContactName: purchaseOrderProviderContactName,
          paymentConditions: purchaseOrderDraft?.paymentConditions || "",
          notes:
            purchaseOrderDraft?.notes ??
            activeProcessingStage?.stageData?.purchaseOrderNotes ??
            DEFAULT_PURCHASE_ORDER_NOTES,
        })
      : null;
  const kickoffExternalGeneratedSummary = String(
    processingData?.kickoffExternal?.aiSummaryCurrent?.summary?.summary || "",
  ).trim();
  const kickoffExternalStageMinutesSummary =
    activeProcessingStage?.stageData?.minutesSummary;
  const kickoffExternalSummaryText = String(
    kickoffExternalStageMinutesSummary == null
      ? kickoffExternalGeneratedSummary
      : kickoffExternalStageMinutesSummary,
  );

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

      {error ? (
        <div className="toast toast-error" role="alert" aria-live="assertive">
          <span>{error}</span>
          <button
            type="button"
            className="toast-close"
            onClick={() => setError("")}
            aria-label="Cerrar notificacion de error"
            title="Cerrar"
          >
            ×
          </button>
        </div>
      ) : null}
      {success ? (
        <div className="toast toast-success" role="status" aria-live="polite">
          <span>{success}</span>
          <button
            type="button"
            className="toast-close"
            onClick={() => setSuccess("")}
            aria-label="Cerrar notificacion de exito"
            title="Cerrar"
          >
            ×
          </button>
        </div>
      ) : null}
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
          </tr>
        </thead>
        <tbody>
          {!loading && pagedQuotations.length > 0 ? (
            pagedQuotations.map((quotation) => (
              <tr
                key={quotation.id}
                className="accounts-row-clickable"
                onClick={() => {
                  void openProcessingModal(quotation);
                }}
              >
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
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={11} className="empty-state">
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

              {!acceptOrderWonDocuments.loading &&
              acceptOrderWonDocuments.error ? (
                <p className="field-hint opportunity-documents-preview-error">
                  {acceptOrderWonDocuments.error}
                </p>
              ) : null}

              {!acceptOrderWonDocuments.loading &&
              !acceptOrderWonDocuments.error ? (
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
                              <strong>
                                {item.originalFileName || "Documento"}
                              </strong>
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
                  {processingData?.quotation?.proposalName ||
                    "Flujo de procesamiento"}
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
            </div>

            <div
              className="processing-stage-flow"
              role="tablist"
              aria-label="Etapas"
            >
              {PROCESSING_STAGE_DEFINITIONS.map((stageDef, index) => {
                const stage = processingStages.find(
                  (item) => item.stageCode === stageDef.code,
                );
                const isActive = activeProcessingStageCode === stageDef.code;
                const status = stage?.status || "not_started";
                const isCompleted = status === "completed";
                const isBlocked = status === "blocked";
                const isNotApplicable = status === "not_applicable";
                return (
                  <button
                    key={stageDef.code}
                    type="button"
                    className={`processing-stage-step${isActive ? " is-active" : ""}${isCompleted ? " is-completed" : ""}${isBlocked ? " is-blocked" : ""}${isNotApplicable ? " is-not-applicable" : ""}`}
                    onClick={() => setActiveProcessingStageCode(stageDef.code)}
                    role="tab"
                    aria-selected={isActive}
                    aria-current={isActive ? "step" : undefined}
                  >
                    <span
                      className="processing-stage-step-circle"
                      aria-hidden="true"
                    >
                      {index + 1}
                    </span>
                    <span className="processing-stage-step-copy">
                      <strong>{stageDef.name}</strong>
                      <small>
                        {PROCESSING_STAGE_STATUS_LABELS[status] ||
                          "No iniciada"}
                      </small>
                    </span>
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

            {!processingLoading &&
            !processingModalError &&
            activeProcessingStage ? (
              <div
                ref={processingStageContentRef}
                className="processing-stage-content"
              >
                {!isKickoffInternalStage &&
                !isKickoffExternalStage &&
                !isProviderPurchaseOrderStage &&
                activeProcessingStage.stageCode !== "products_reception" &&
                activeProcessingStage.stageCode !== "preworks" &&
                activeProcessingStage.stageCode !== "products_delivery" ? (
                  <section className="processing-stage-box">
                    <header>
                      <h4>{activeProcessingStage.stageName}</h4>
                      <p>
                        {isQuotationAcceptedStage
                          ? activeProcessingStage.status === "completed"
                            ? "La cotizacion ya fue aceptada. Aqui puedes revisar la evidencia y los datos registrados."
                            : "La cotizacion aun no esta aceptada. Revisa la informacion y confirma esta etapa con el boton Aceptar."
                          : "Edita esta etapa de forma independiente. El flujo no requiere secuencia estricta."}
                      </p>
                    </header>

                    {isQuotationAcceptedStage ? (
                      <div className="processing-accepted-scroll-area">
                        <div className="processing-accepted-status-row">
                          <span
                            className={`processing-accepted-status-indicator${
                              activeProcessingStage.status === "completed"
                                ? " is-completed"
                                : ""
                            }`}
                          >
                            <span
                              className="processing-accepted-status-icon"
                              aria-hidden="true"
                            >
                              {activeProcessingStage.status === "completed"
                                ? "✓"
                                : "○"}
                            </span>
                            <span>
                              {activeProcessingStage.status === "completed"
                                ? "Aceptada"
                                : "Pendiente de aceptar"}
                            </span>
                          </span>
                        </div>

                        <div className="accept-order-modal-summary">
                          <div>
                            <span>Oportunidad</span>
                            <strong>
                              {quotationToProcess?.opportunityName || "-"}
                            </strong>
                          </div>
                          <div>
                            <span>Vendedor</span>
                            <strong>
                              {quotationToProcess?.sellerUserName || "-"}
                            </strong>
                          </div>
                          <div>
                            <span>Cierre</span>
                            <strong>
                              {formatDate(
                                quotationToProcess?.opportunityCloseDate,
                              )}
                            </strong>
                          </div>
                        </div>

                        <div className="accept-order-total-card">
                          <div>
                            <span>Importe total</span>
                            <strong>
                              {formatCurrency(
                                processingFinancials.totalSale,
                                processingCurrencyCode,
                              )}
                            </strong>
                          </div>
                          <div>
                            <span>Costo total</span>
                            <strong>
                              {formatCurrency(
                                processingFinancials.totalCost,
                                processingCurrencyCode,
                              )}
                            </strong>
                          </div>
                          <div>
                            <span>Contribucion total</span>
                            <strong>
                              {formatCurrency(
                                processingFinancials.totalContribution,
                                processingCurrencyCode,
                              )}
                            </strong>
                            <small>
                              {formatPercent(
                                processingFinancials.totalContributionPct,
                              )}
                            </small>
                          </div>
                        </div>

                        <div className="accept-order-financial-grid">
                          <div className="accept-order-financial-card">
                            <div className="accept-order-financial-card-header">
                              <span>Productos</span>
                              <strong>
                                {formatPercent(
                                  processingFinancials.productContributionPct,
                                )}
                              </strong>
                            </div>
                            <dl>
                              <div>
                                <dt>Venta</dt>
                                <dd>
                                  {formatCurrency(
                                    processingFinancials.productSale,
                                    processingCurrencyCode,
                                  )}
                                </dd>
                              </div>
                              <div>
                                <dt>Costo</dt>
                                <dd>
                                  {formatCurrency(
                                    processingFinancials.productCost,
                                    processingCurrencyCode,
                                  )}
                                </dd>
                              </div>
                              <div>
                                <dt>Contribucion</dt>
                                <dd>
                                  {formatCurrency(
                                    processingFinancials.productContribution,
                                    processingCurrencyCode,
                                  )}
                                </dd>
                              </div>
                            </dl>
                          </div>
                          <div className="accept-order-financial-card">
                            <div className="accept-order-financial-card-header">
                              <span>Servicios</span>
                              <strong>
                                {formatPercent(
                                  processingFinancials.serviceContributionPct,
                                )}
                              </strong>
                            </div>
                            <dl>
                              <div>
                                <dt>Venta</dt>
                                <dd>
                                  {formatCurrency(
                                    processingFinancials.serviceSale,
                                    processingCurrencyCode,
                                  )}
                                </dd>
                              </div>
                              <div>
                                <dt>Costo</dt>
                                <dd>
                                  {formatCurrency(
                                    processingFinancials.serviceCost,
                                    processingCurrencyCode,
                                  )}
                                </dd>
                              </div>
                              <div>
                                <dt>Contribucion</dt>
                                <dd>
                                  {formatCurrency(
                                    processingFinancials.serviceContribution,
                                    processingCurrencyCode,
                                  )}
                                </dd>
                              </div>
                            </dl>
                          </div>
                        </div>

                        <section className="accept-order-won-documents-card processing-accepted-won-documents-card">
                          <header className="accept-order-won-documents-header">
                            <h4>Documentos de cierre</h4>
                            <p>
                              Archivos seleccionados cuando la cotizacion fue
                              declarada como ganada.
                            </p>
                          </header>

                          {processingWonDocuments.loading ? (
                            <p className="field-hint">
                              Cargando documentos de cierre...
                            </p>
                          ) : null}

                          {!processingWonDocuments.loading &&
                          processingWonDocuments.error ? (
                            <p className="field-hint opportunity-documents-preview-error">
                              {processingWonDocuments.error}
                            </p>
                          ) : null}

                          {!processingWonDocuments.loading &&
                          !processingWonDocuments.error ? (
                            <div className="accept-order-won-documents-grid">
                              <section className="accept-order-won-documents-section">
                                <h5>1) Orden de compra</h5>
                                {processingWonDocuments.purchaseOrder ? (
                                  <article className="accept-order-won-document-item">
                                    <div className="accept-order-won-document-item-main">
                                      <strong>
                                        {processingWonDocuments.purchaseOrder
                                          .originalFileName || "Documento"}
                                      </strong>
                                      <span className="field-hint">
                                        {formatWonDocumentSourceLabel(
                                          processingWonDocuments.purchaseOrder
                                            .source,
                                        )}
                                      </span>
                                    </div>
                                    <button
                                      type="button"
                                      className="btn-secondary accept-order-won-document-download-btn"
                                      onClick={() => {
                                        void handleDownloadWonDocument(
                                          processingWonDocuments.purchaseOrder,
                                        );
                                      }}
                                      disabled={
                                        downloadingWonDocumentKey ===
                                        `${processingWonDocuments.purchaseOrder.source}:${processingWonDocuments.purchaseOrder.documentId}`
                                      }
                                      title="Descargar documento"
                                      aria-label="Descargar documento"
                                    >
                                      <svg
                                        viewBox="0 0 24 24"
                                        aria-hidden="true"
                                      >
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
                                {processingWonDocuments.providerQuotes
                                  .length ? (
                                  <div className="accept-order-won-documents-list">
                                    {processingWonDocuments.providerQuotes.map(
                                      (item) => (
                                        <article
                                          key={`provider-quote-${item.source}-${item.documentId}`}
                                          className="accept-order-won-document-item"
                                        >
                                          <div className="accept-order-won-document-item-main">
                                            <strong>
                                              {item.originalFileName ||
                                                "Documento"}
                                            </strong>
                                            <span className="field-hint">
                                              {formatWonDocumentSourceLabel(
                                                item.source,
                                              )}
                                            </span>
                                          </div>
                                          <button
                                            type="button"
                                            className="btn-secondary accept-order-won-document-download-btn"
                                            onClick={() => {
                                              void handleDownloadWonDocument(
                                                item,
                                              );
                                            }}
                                            disabled={
                                              downloadingWonDocumentKey ===
                                              `${item.source}:${item.documentId}`
                                            }
                                            title="Descargar documento"
                                            aria-label="Descargar documento"
                                          >
                                            <svg
                                              viewBox="0 0 24 24"
                                              aria-hidden="true"
                                            >
                                              <path d="M12 3.75a.75.75 0 0 1 .75.75v8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 1 1 1.06-1.06l2.72 2.72V4.5a.75.75 0 0 1 .75-.75ZM5 18.25a.75.75 0 0 1 .75.75v.25a1 1 0 0 0 1 1h10.5a1 1 0 0 0 1-1V19a.75.75 0 0 1 1.5 0v.25a2.5 2.5 0 0 1-2.5 2.5H6.75a2.5 2.5 0 0 1-2.5-2.5V19a.75.75 0 0 1 .75-.75Z" />
                                            </svg>
                                          </button>
                                        </article>
                                      ),
                                    )}
                                  </div>
                                ) : (
                                  <p className="field-hint">
                                    No hay cotizaciones de proveedores
                                    registradas.
                                  </p>
                                )}
                              </section>
                            </div>
                          ) : null}
                        </section>

                        <div className="processing-stage-grid two">
                          <label className="field-group processing-stage-field">
                            <span>Fecha de aceptacion</span>
                            <input
                              type="date"
                              value={
                                activeProcessingStage.stageData?.acceptedAt
                                  ? String(
                                      activeProcessingStage.stageData
                                        .acceptedAt,
                                    ).slice(0, 10)
                                  : ""
                              }
                              onChange={(event) =>
                                updateActiveStageDataField(
                                  "acceptedAt",
                                  event.target.value
                                    ? new Date(
                                        `${event.target.value}T12:00:00.000Z`,
                                      ).toISOString()
                                    : null,
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
                                updateActiveStageCommonField(
                                  "notes",
                                  event.target.value,
                                )
                              }
                              disabled={!processingData.permissions?.canUpdate}
                            />
                          </label>
                        </div>
                      </div>
                    ) : !isKickoffInternalStage ? (
                      <div className="processing-stage-grid two">
                        <label className="field-group processing-stage-field">
                          <span>Estado</span>
                          <select
                            value={
                              activeProcessingStage.status || "not_started"
                            }
                            onChange={(event) =>
                              updateActiveStageCommonField(
                                "status",
                                event.target.value,
                              )
                            }
                            disabled={!processingData.permissions?.canUpdate}
                          >
                            {PROCESSING_STAGE_STATUS_OPTIONS.map(
                              (statusOption) => (
                                <option
                                  key={statusOption.value}
                                  value={statusOption.value}
                                >
                                  {statusOption.label}
                                </option>
                              ),
                            )}
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
                                ? String(
                                    activeProcessingStage.completedAt,
                                  ).slice(0, 16)
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
                              updateActiveStageCommonField(
                                "notes",
                                event.target.value,
                              )
                            }
                            disabled={!processingData.permissions?.canUpdate}
                          />
                        </label>
                      </div>
                    ) : null}

                    <div
                      className={`processing-stage-actions${
                        isQuotationAcceptedStage
                          ? " processing-stage-actions-sticky"
                          : ""
                      }`}
                    >
                      {isQuotationAcceptedStage ? (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() =>
                            openSellerNotificationModal(quotationToProcess)
                          }
                          disabled={Boolean(sendingNotificationQuotationId)}
                        >
                          Correo vendedor
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => {
                          if (isQuotationAcceptedStage) {
                            void (async () => {
                              const acceptedAtIso =
                                activeProcessingStage.stageData?.acceptedAt ||
                                activeProcessingStage.completedAt ||
                                new Date().toISOString();
                              const quotationAccepted =
                                isAcceptedQuotation(quotationToProcess) ||
                                (await acceptQuotationFromProcessing(
                                  quotationToProcess,
                                ));
                              if (!quotationAccepted) {
                                return;
                              }

                              await saveProcessingStage(
                                activeProcessingStage.stageCode,
                                {
                                  forceStatus: "completed",
                                  forceCompletedAt: acceptedAtIso,
                                  stageDataPatch: {
                                    acceptedAt: acceptedAtIso,
                                  },
                                },
                              );
                            })();
                            return;
                          }
                          void saveProcessingStage(
                            activeProcessingStage.stageCode,
                          );
                        }}
                        disabled={
                          !processingData.permissions?.canUpdate ||
                          Boolean(acceptingVersionId) ||
                          processingSavingStageCode ===
                            activeProcessingStage.stageCode
                        }
                      >
                        {processingSavingStageCode ===
                        activeProcessingStage.stageCode
                          ? "Guardando..."
                          : isQuotationAcceptedStage
                            ? "Aceptar"
                            : "Guardar etapa"}
                      </button>
                    </div>
                  </section>
                ) : null}

                {activeProcessingStage.stageCode === "kickoff_internal" ? (
                  <>
                    <section className="processing-stage-box">
                      <header>
                        <h5>Convocatoria Kick Off interno</h5>
                        <p>
                          Selecciona convocados internos y dos fechas
                          propuestas.
                        </p>
                      </header>

                      <div className="processing-stage-grid two">
                        <label className="field-group processing-stage-field kickoff-internal-users-field">
                          <span>Convocados internos</span>
                          <div className="kickoff-internal-users-picker">
                            {processingUsers.map((user) => {
                              const isSelected =
                                kickoffInvitationDraft.internalAttendeesUserIds.includes(
                                  Number(user.id),
                                );
                              return (
                                <label
                                  key={user.id}
                                  className="kickoff-internal-user-choice"
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={(event) => {
                                      setKickoffInvitationDraft((current) => {
                                        const currentIds = Array.isArray(
                                          current.internalAttendeesUserIds,
                                        )
                                          ? current.internalAttendeesUserIds
                                          : [];
                                        const nextIds = event.target.checked
                                          ? Array.from(
                                              new Set([
                                                ...currentIds,
                                                Number(user.id),
                                              ]),
                                            )
                                          : currentIds.filter(
                                              (id) =>
                                                Number(id) !== Number(user.id),
                                            );
                                        return {
                                          ...current,
                                          internalAttendeesUserIds: nextIds,
                                        };
                                      });
                                    }}
                                  />
                                  <span>
                                    {user.fullName}{" "}
                                    {user.email ? `(${user.email})` : ""}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                          <span className="field-hint">
                            Seleccionados:{" "}
                            {
                              kickoffInvitationDraft.internalAttendeesUserIds
                                .length
                            }
                          </span>
                        </label>

                        <label className="field-group processing-stage-field kickoff-internal-right-field">
                          <span>Opcion 1 (fecha y hora)</span>
                          <div className="kickoff-internal-date-time-row">
                            <input
                              type="date"
                              value={
                                kickoffInvitationDraft.meetingDateOptionOne
                              }
                              onChange={(event) =>
                                setKickoffInvitationDraft((current) => ({
                                  ...current,
                                  meetingDateOptionOne: event.target.value,
                                }))
                              }
                            />
                            <input
                              type="time"
                              value={
                                kickoffInvitationDraft.meetingTimeOptionOne
                              }
                              onChange={(event) =>
                                setKickoffInvitationDraft((current) => ({
                                  ...current,
                                  meetingTimeOptionOne: event.target.value,
                                }))
                              }
                            />
                          </div>
                        </label>

                        <label className="field-group processing-stage-field kickoff-internal-right-field">
                          <span>Opcion 2 (fecha y hora)</span>
                          <div className="kickoff-internal-date-time-row">
                            <input
                              type="date"
                              value={
                                kickoffInvitationDraft.meetingDateOptionTwo
                              }
                              onChange={(event) =>
                                setKickoffInvitationDraft((current) => ({
                                  ...current,
                                  meetingDateOptionTwo: event.target.value,
                                }))
                              }
                            />
                            <input
                              type="time"
                              value={
                                kickoffInvitationDraft.meetingTimeOptionTwo
                              }
                              onChange={(event) =>
                                setKickoffInvitationDraft((current) => ({
                                  ...current,
                                  meetingTimeOptionTwo: event.target.value,
                                }))
                              }
                            />
                          </div>
                        </label>

                        <label className="field-group processing-stage-field kickoff-internal-right-field">
                          <span>Modalidad</span>
                          <select
                            value={
                              kickoffInvitationDraft.meetingMode || "virtual"
                            }
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

                        {kickoffInvitationDraft.meetingMode === "presencial" ? (
                          <label className="field-group processing-stage-field kickoff-internal-right-field">
                            <span>Ubicacion</span>
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
                        ) : null}
                      </div>

                      <div className="processing-stage-actions split">
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={openKickoffInvitationPreviewModal}
                          disabled={!processingData.permissions?.canConvoke}
                        >
                          Abrir vista previa de correo
                        </button>
                        <span className="field-hint">
                          {processingData?.kickoffInternal?.latestInvitation
                            ?.statusCode === "sent"
                            ? "Ultima convocatoria enviada"
                            : "Sin convocatoria enviada"}
                        </span>
                      </div>

                      {Array.isArray(
                        processingData?.kickoffInternal?.invitations,
                      ) && processingData.kickoffInternal.invitations.length ? (
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

                    <section className="processing-stage-box">
                      <header>
                        <h5>Minuta</h5>
                        <p>
                          Carga archivo de texto o audio, genera resumen IA y
                          culmina el step.
                        </p>
                      </header>

                      <div className="processing-stage-grid two">
                        <label className="field-group processing-stage-field full">
                          <span>Archivo de minuta (texto/audio)</span>
                          <input
                            type="file"
                            accept=".txt,.md,.csv,.pdf,.doc,.docx,audio/*"
                            onChange={(event) => {
                              const selectedFiles = event.target.files;
                              void uploadKickoffInternalEvidence(selectedFiles);
                              event.target.value = "";
                            }}
                            disabled={
                              uploadingKickoffInternalEvidence ||
                              !processingData.permissions?.canUpdate
                            }
                          />
                        </label>

                        <div className="processing-stage-field full">
                          {kickoffInternalEvidences.length ? (
                            <div className="processing-stage-log-list">
                              {kickoffInternalEvidences
                                .slice(0, 8)
                                .map((evidence) => {
                                  const evidenceId = Number(evidence.id || 0);
                                  const deletingEvidence =
                                    deletingProcessingEvidenceIds.has(
                                      evidenceId,
                                    );
                                  return (
                                    <article
                                      key={evidence.id}
                                      className="processing-stage-log-item"
                                    >
                                      <div>
                                        <strong>
                                          {evidence.document
                                            ?.originalFileName ||
                                            "Evidencia de minuta"}
                                        </strong>
                                        <span className="field-hint">
                                          {evidence.createdByUserName ||
                                            "Usuario"}
                                          {" · "}
                                          {formatDate(evidence.createdAt)}
                                        </span>
                                      </div>
                                      <div className="processing-stage-actions split">
                                        {evidence.document ? (
                                          <button
                                            type="button"
                                            className="btn-ghost processing-evidence-icon-button"
                                            onClick={() =>
                                              void downloadKickoffEvidence(
                                                evidence,
                                              )
                                            }
                                            disabled={deletingEvidence}
                                            title="Descargar evidencia"
                                            aria-label="Descargar evidencia"
                                          >
                                            <svg
                                              viewBox="0 0 24 24"
                                              aria-hidden="true"
                                            >
                                              <path d="M12 3.75a.75.75 0 0 1 .75.75v8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 1 1 1.06-1.06l2.72 2.72V4.5a.75.75 0 0 1 .75-.75ZM5 18.25a.75.75 0 0 1 .75.75v.25a1 1 0 0 0 1 1h10.5a1 1 0 0 0 1-1V19a.75.75 0 0 1 1.5 0v.25a2.5 2.5 0 0 1-2.5 2.5H6.75a2.5 2.5 0 0 1-2.5-2.5V19a.75.75 0 0 1 .75-.75Z" />
                                            </svg>
                                          </button>
                                        ) : null}
                                        <button
                                          type="button"
                                          className="btn-danger processing-evidence-icon-button processing-evidence-delete-button"
                                          onClick={() =>
                                            void deleteKickoffEvidence(evidence)
                                          }
                                          disabled={
                                            deletingEvidence ||
                                            !processingData.permissions
                                              ?.canUpdate
                                          }
                                          title={
                                            deletingEvidence
                                              ? "Eliminando evidencia"
                                              : "Eliminar evidencia"
                                          }
                                          aria-label={
                                            deletingEvidence
                                              ? "Eliminando evidencia"
                                              : "Eliminar evidencia"
                                          }
                                        >
                                          <svg
                                            viewBox="0 0 24 24"
                                            aria-hidden="true"
                                          >
                                            <path d="M9 3.75A2.25 2.25 0 0 0 6.75 6v.75H4.5a.75.75 0 0 0 0 1.5h.62l.84 10.03A2.25 2.25 0 0 0 8.2 20.25h7.6a2.25 2.25 0 0 0 2.24-1.97l.84-10.03h.62a.75.75 0 0 0 0-1.5h-2.25V6A2.25 2.25 0 0 0 15 3.75zM8.25 6A.75.75 0 0 1 9 5.25h6a.75.75 0 0 1 .75.75v.75h-7.5zm1.5 4.25a.75.75 0 0 0-1.5 0v6a.75.75 0 0 0 1.5 0zm3.75-.75a.75.75 0 0 1 .75.75v6a.75.75 0 0 1-1.5 0v-6a.75.75 0 0 1 .75-.75zm3 .75a.75.75 0 0 0-1.5 0v6a.75.75 0 0 0 1.5 0z" />
                                          </svg>
                                        </button>
                                      </div>
                                    </article>
                                  );
                                })}
                            </div>
                          ) : (
                            <p className="field-hint">
                              Aun no se registran archivos en la minuta de Kick
                              Off interno.
                            </p>
                          )}
                        </div>

                        <label className="field-group processing-stage-field full">
                          <span>Resumen de minuta</span>
                          <textarea
                            rows={6}
                            value={kickoffInternalSummaryText}
                            onChange={(event) =>
                              updateActiveStageDataField(
                                "minutesSummary",
                                event.target.value,
                              )
                            }
                            placeholder="Resumen de acuerdos, responsables y proximos pasos"
                          />
                        </label>
                      </div>

                      <div className="processing-stage-actions split">
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() =>
                            void generateKickoffInternalAiSummary()
                          }
                          disabled={
                            generatingKickoffInternalAi ||
                            !processingData.permissions?.canGenerateIa
                          }
                        >
                          {generatingKickoffInternalAi
                            ? "Generando resumen..."
                            : "IA resumir"}
                        </button>

                        <button
                          type="button"
                          className="btn-primary"
                          onClick={() =>
                            void saveProcessingStage(
                              activeProcessingStage.stageCode,
                              {
                                forceStatus: "completed",
                                forceCompletedAt: new Date().toISOString(),
                              },
                            )
                          }
                          disabled={
                            !processingData.permissions?.canUpdate ||
                            processingSavingStageCode ===
                              activeProcessingStage.stageCode
                          }
                        >
                          Culminar Kick Off Interno
                        </button>
                      </div>
                    </section>
                  </>
                ) : null}

                {activeProcessingStage.stageCode === "kickoff_external" ? (
                  <section className="processing-stage-box">
                    <header>
                      <h5>Minuta</h5>
                      <p>
                        Carga archivo de texto o audio, genera resumen IA y
                        culmina el step.
                      </p>
                    </header>

                    <div className="processing-stage-grid two">
                      <label className="field-group processing-stage-field full">
                        <span>Archivo de minuta (texto/audio)</span>
                        <input
                          type="file"
                          accept=".txt,.md,.csv,.pdf,.doc,.docx,audio/*"
                          onChange={(event) => {
                            const selectedFiles = event.target.files;
                            if (selectedFiles?.length) {
                              void uploadKickoffExternalEvidence(selectedFiles);
                            }
                            event.target.value = "";
                          }}
                          disabled={
                            uploadingKickoffExternalEvidence ||
                            !processingData.permissions?.canUpdate
                          }
                        />
                      </label>

                      <div className="processing-stage-field full">
                        {kickoffExternalEvidences.length ? (
                          <div className="processing-stage-log-list">
                            {kickoffExternalEvidences.map((evidence) => {
                              const evidenceId = Number(evidence.id || 0);
                              const deletingEvidence =
                                deletingProcessingEvidenceIds.has(evidenceId);
                              return (
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
                                      {evidence.evidenceType} ·{" "}
                                      {formatDate(evidence.createdAt)}
                                    </span>
                                  </div>
                                  <div className="processing-stage-actions split">
                                    {evidence.document ? (
                                      <button
                                        type="button"
                                        className="btn-secondary processing-evidence-icon-button"
                                        onClick={() =>
                                          void downloadKickoffEvidence(evidence)
                                        }
                                        disabled={deletingEvidence}
                                        title="Descargar evidencia"
                                        aria-label="Descargar evidencia"
                                      >
                                        <svg
                                          viewBox="0 0 24 24"
                                          aria-hidden="true"
                                        >
                                          <path d="M12 3.75a.75.75 0 0 1 .75.75v8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 1 1 1.06-1.06l2.72 2.72V4.5a.75.75 0 0 1 .75-.75ZM5 18.25a.75.75 0 0 1 .75.75v.25a1 1 0 0 0 1 1h10.5a1 1 0 0 0 1-1V19a.75.75 0 0 1 1.5 0v.25a2.5 2.5 0 0 1-2.5 2.5H6.75a2.5 2.5 0 0 1-2.5-2.5V19a.75.75 0 0 1 .75-.75Z" />
                                        </svg>
                                      </button>
                                    ) : null}
                                    {evidence.document ? (
                                      <button
                                        type="button"
                                        className="btn-danger processing-evidence-icon-button processing-evidence-delete-button"
                                        onClick={() =>
                                          void deleteKickoffEvidence(evidence)
                                        }
                                        disabled={
                                          deletingEvidence ||
                                          !processingData.permissions?.canUpdate
                                        }
                                        title={
                                          deletingEvidence
                                            ? "Eliminando evidencia"
                                            : "Eliminar evidencia"
                                        }
                                        aria-label={
                                          deletingEvidence
                                            ? "Eliminando evidencia"
                                            : "Eliminar evidencia"
                                        }
                                      >
                                        <svg
                                          viewBox="0 0 24 24"
                                          aria-hidden="true"
                                        >
                                          <path d="M9 3.75A2.25 2.25 0 0 0 6.75 6v.75H4.5a.75.75 0 0 0 0 1.5h.62l.84 10.03A2.25 2.25 0 0 0 8.2 20.25h7.6a2.25 2.25 0 0 0 2.24-1.97l.84-10.03h.62a.75.75 0 0 0 0-1.5h-2.25V6A2.25 2.25 0 0 0 15 3.75zM8.25 6A.75.75 0 0 1 9 5.25h6a.75.75 0 0 1 .75.75v.75h-7.5zm1.5 4.25a.75.75 0 0 0-1.5 0v6a.75.75 0 0 0 1.5 0zm3.75-.75a.75.75 0 0 1 .75.75v6a.75.75 0 0 1-1.5 0v-6a.75.75 0 0 1 .75-.75zm3 .75a.75.75 0 0 0-1.5 0v6a.75.75 0 0 0 1.5 0z" />
                                        </svg>
                                      </button>
                                    ) : null}
                                  </div>
                                </article>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="field-hint">
                            Aun no existen evidencias en Kick Off externo.
                          </p>
                        )}
                      </div>

                      <label className="field-group processing-stage-field full">
                        <span>Resumen de minuta</span>
                        <textarea
                          rows={6}
                          value={kickoffExternalSummaryText}
                          onChange={(event) =>
                            updateActiveStageDataField(
                              "minutesSummary",
                              event.target.value,
                            )
                          }
                          placeholder="Resumen de acuerdos, responsables y proximos pasos"
                        />
                      </label>
                    </div>

                    <div className="processing-stage-actions split">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => void generateKickoffExternalAiSummary()}
                        disabled={
                          generatingKickoffExternalAi ||
                          !processingData.permissions?.canGenerateIa
                        }
                      >
                        {generatingKickoffExternalAi
                          ? "Generando resumen..."
                          : "IA resumir"}
                      </button>

                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() =>
                          void saveProcessingStage(
                            activeProcessingStage.stageCode,
                            {
                              forceStatus: "completed",
                              forceCompletedAt: new Date().toISOString(),
                            },
                          )
                        }
                        disabled={
                          !processingData.permissions?.canUpdate ||
                          processingSavingStageCode ===
                            activeProcessingStage.stageCode
                        }
                      >
                        Culminar Kick Off Externo
                      </button>
                    </div>
                  </section>
                ) : null}

                {activeProcessingStage.stageCode !== "quotation_accepted" &&
                activeProcessingStage.stageCode !== "kickoff_external" &&
                activeProcessingStage.stageCode !== "kickoff_internal"
                  ? renderStageBaseSpecificFields(activeProcessingStage)
                  : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {purchaseOrderModalOpen && purchaseOrderDraft ? (
        <div
          className="modal-overlay modal-overlay-elevated"
          role="dialog"
          aria-modal="true"
          aria-labelledby="purchase-order-modal-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closePurchaseOrderModal();
            }
          }}
        >
          <div className="modal-dialog processing-purchase-order-modal">
            <div className="accept-order-notification-header">
              <span>Orden de compra</span>
              <h3 id="purchase-order-modal-title">Generar orden</h3>
              <p>
                Se generara una orden por proveedor con los items seleccionados.
              </p>
            </div>

            <section className="processing-stage-box">
              <header>
                <h4>Datos de orden de compra</h4>
              </header>
              <div className="processing-stage-grid two">
                <label className="field-group processing-stage-field">
                  <span>Proveedor</span>
                  <input
                    type="text"
                    value={purchaseOrderDraft.providerName || "Proveedor"}
                    readOnly
                    disabled
                  />
                </label>
                <label className="field-group processing-stage-field">
                  <span>Contacto del proveedor</span>
                  <select
                    value={purchaseOrderDraft.providerContactId || ""}
                    onChange={(event) => {
                      const providerContactId = event.target.value
                        ? Number(event.target.value)
                        : null;
                      setPurchaseOrderDraft((current) =>
                        current ? { ...current, providerContactId } : current,
                      );
                      updateActiveStageDataField(
                        "providerContactId",
                        providerContactId,
                      );
                    }}
                    disabled={!processingData.permissions?.canUpdate}
                  >
                    <option value="">
                      {purchaseOrderDraft.providerContacts.length
                        ? "Selecciona contacto"
                        : "Proveedor sin contactos"}
                    </option>
                    {purchaseOrderDraft.providerContacts.map((contact) => {
                      const fullName = [contact.firstName, contact.lastName]
                        .filter(Boolean)
                        .join(" ");
                      return (
                        <option key={contact.id} value={contact.id}>
                          {fullName ||
                            contact.email ||
                            `Contacto #${contact.id}`}
                          {fullName && contact.email
                            ? ` (${contact.email})`
                            : ""}
                        </option>
                      );
                    })}
                  </select>
                </label>
                <label className="field-group processing-stage-field">
                  <span>Cliente final</span>
                  <input
                    type="text"
                    value={purchaseOrderDraft.finalCustomerName || "-"}
                    readOnly
                    disabled
                  />
                </label>
                <label className="field-group processing-stage-field">
                  <span>Cotizacion del proveedor</span>
                  <input
                    type="text"
                    value={purchaseOrderDraft.providerQuotation || ""}
                    placeholder="Ingresa la cotizacion del proveedor"
                    onChange={(event) => {
                      const providerQuotation = event.target.value;
                      setPurchaseOrderDraft((current) =>
                        current ? { ...current, providerQuotation } : current,
                      );
                      updateActiveStageDataField(
                        "providerQuotation",
                        providerQuotation,
                      );
                    }}
                    disabled={!processingData.permissions?.canUpdate}
                  />
                </label>
              </div>
            </section>

            {purchaseOrderDraftOrders.map((order) => {
              const orderLines = Array.isArray(order?.lines) ? order.lines : [];
              const subtotal = orderLines.reduce(
                (sum, line) => sum + calculatePurchaseOrderLineAmount(line),
                0,
              );
              const ivaPct = normalizePositiveNumber(order?.ivaPct, 16);
              const ivaAmount = subtotal * (ivaPct / 100);
              const total = subtotal + ivaAmount;

              return (
                <section
                  key={order.draftId}
                  className="processing-purchase-order-lines"
                >
                  <header className="processing-purchase-order-lines-header">
                    <h4>{order.providerName || "Proveedor"}</h4>
                    <span>{orderLines.length} item(s)</span>
                  </header>

                  <div className="processing-stage-grid two">
                    <label className="field-group processing-stage-field">
                      <span>Orden #</span>
                      <input
                        type="text"
                        value={order.orderNumber || "Pendiente"}
                        readOnly
                      />
                    </label>
                  </div>

                  <div className="processing-products-table-wrap">
                    <table className="processing-products-table">
                      <thead>
                        <tr>
                          <th>Codigo</th>
                          <th>Descripcion</th>
                          <th className="is-right">Cantidad</th>
                          <th className="is-right">Costo unitario</th>
                          <th className="is-right">Importe</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orderLines.map((line) => (
                          <tr key={`${order.draftId}-${line.lineId}`}>
                            <td>{line.code || "-"}</td>
                            <td>{line.description || "Sin descripcion"}</td>
                            <td className="is-right">
                              {Number(
                                normalizePositiveNumber(line.quantity, 0),
                              ).toLocaleString("es-MX", {
                                maximumFractionDigits: 4,
                              })}
                            </td>
                            <td className="is-right">
                              {formatCurrency(
                                Number(
                                  normalizePositiveNumber(line.unitCost, 0),
                                ),
                                order.currencyCode ||
                                  purchaseOrderDraft.currencyCode ||
                                  processingCurrencyCode,
                              )}
                            </td>
                            <td className="is-right">
                              {formatCurrency(
                                calculatePurchaseOrderLineAmount(line),
                                order.currencyCode ||
                                  purchaseOrderDraft.currencyCode ||
                                  processingCurrencyCode,
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="purchase-order-preview-totals">
                    <div>
                      <span>Subtotal</span>
                      <strong>
                        {formatCurrency(
                          subtotal,
                          order.currencyCode ||
                            purchaseOrderDraft.currencyCode ||
                            processingCurrencyCode,
                        )}
                      </strong>
                    </div>
                    <div>
                      <span>I.V.A.</span>
                      <strong>
                        {formatCurrency(
                          ivaAmount,
                          order.currencyCode ||
                            purchaseOrderDraft.currencyCode ||
                            processingCurrencyCode,
                        )}
                      </strong>
                    </div>
                    <div>
                      <span>Total</span>
                      <strong>
                        {formatCurrency(
                          total,
                          order.currencyCode ||
                            purchaseOrderDraft.currencyCode ||
                            processingCurrencyCode,
                        )}
                      </strong>
                    </div>
                  </div>
                </section>
              );
            })}

            <section className="processing-stage-box">
              <header>
                <h4>Condiciones de la orden</h4>
              </header>
              <div className="processing-stage-grid two">
                <label className="field-group processing-stage-field full">
                  <span>Condiciones de pago</span>
                  <input
                    type="text"
                    value={purchaseOrderDraft.paymentConditions || ""}
                    placeholder="Ingresa las condiciones de pago"
                    onChange={(event) => {
                      const paymentConditions = event.target.value;
                      setPurchaseOrderDraft((current) =>
                        current ? { ...current, paymentConditions } : current,
                      );
                      updateActiveStageDataField(
                        "purchaseOrderPaymentConditions",
                        paymentConditions,
                      );
                    }}
                    disabled={!processingData.permissions?.canUpdate}
                  />
                </label>
                <label className="field-group processing-stage-field">
                  <span>Tiempo de entrega</span>
                  <input
                    type="text"
                    value={purchaseOrderDraft.deliveryTime || "-"}
                    readOnly
                    disabled
                  />
                </label>
                <label className="field-group processing-stage-field">
                  <span>Moneda</span>
                  <input
                    type="text"
                    value={purchaseOrderDraft.currencyCode || "USD"}
                    readOnly
                    disabled
                  />
                </label>
                <label className="field-group processing-stage-field full">
                  <span>Notas</span>
                  <textarea
                    rows={8}
                    value={purchaseOrderDraft.notes || ""}
                    onChange={(event) => {
                      const notes = event.target.value;
                      setPurchaseOrderDraft((current) =>
                        current ? { ...current, notes } : current,
                      );
                      updateActiveStageDataField("purchaseOrderNotes", notes);
                    }}
                    disabled={!processingData.permissions?.canUpdate}
                  />
                </label>
              </div>
            </section>

            <div className="processing-stage-actions split">
              <button
                type="button"
                className="btn-secondary"
                onClick={closePurchaseOrderModal}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={openPurchaseOrderFinalPreview}
              >
                Generar orden
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {purchaseOrderModalOpen && purchaseOrderFinalPreviewOpen ? (
        <PurchaseOrderPrintPreviewModal
          isOpen={purchaseOrderFinalPreviewOpen}
          model={purchaseOrderPrintModel}
          onClose={() => setPurchaseOrderFinalPreviewOpen(false)}
          onConfirm={confirmGeneratePurchaseOrdersFromPreview}
        />
      ) : null}

      {generatedPurchaseOrderPreviewModel ? (
        <PurchaseOrderPrintPreviewModal
          isOpen
          title="Vista previa de orden"
          model={generatedPurchaseOrderPreviewModel}
          onClose={() => setGeneratedPurchaseOrderPreviewModel(null)}
        />
      ) : null}

      {customStepItemPicker.isOpen ? (
        <div
          className="modal-overlay modal-overlay-elevated"
          role="dialog"
          aria-modal="true"
          aria-labelledby="custom-step-item-picker-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeCustomStepItemPicker();
            }
          }}
        >
          <div className="modal-dialog processing-custom-item-picker-modal">
            <div className="accept-order-notification-header">
              <span>Seleccion de item</span>
              <h3 id="custom-step-item-picker-title">
                Seleccionar producto de cotizacion
              </h3>
              <p>
                Doble clic en código abre este selector. Elige un item para
                precargar codigo, descripcion, proveedor y costo.
              </p>
            </div>

            <div className="processing-stage-grid two">
              <label className="field-group processing-stage-field">
                <span>Proveedor</span>
                <select
                  value={customStepItemPicker.providerId}
                  onChange={(event) =>
                    setCustomStepItemPicker((current) => ({
                      ...current,
                      providerId: event.target.value,
                      priceListId: "",
                      activeLists: [],
                      unavailableListMessage: "",
                      results: [],
                    }))
                  }
                >
                  <option value="">Selecciona proveedor</option>
                  {processingProviders.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field-group processing-stage-field">
                <span>Buscar</span>
                <input
                  type="text"
                  placeholder={
                    customStepItemPicker.providerId
                      ? customStepItemPicker.priceListId
                        ? "Codigo o descripcion"
                        : customStepItemPicker.loadingLists
                          ? "Cargando lista activa..."
                          : "Proveedor sin lista activa"
                      : "Selecciona proveedor"
                  }
                  value={customStepItemPicker.query}
                  disabled={!customStepItemPicker.priceListId}
                  onChange={(event) =>
                    setCustomStepItemPicker((current) => ({
                      ...current,
                      query: event.target.value,
                    }))
                  }
                  autoFocus
                />
              </label>
            </div>

            {customStepItemPicker.error ? (
              <p className="field-hint">{customStepItemPicker.error}</p>
            ) : null}

            <div className="processing-products-table-wrap">
              <table className="processing-products-table">
                <thead>
                  <tr>
                    <th>Codigo</th>
                    <th>Descripcion</th>
                    <th>Lista</th>
                    <th>Proveedor</th>
                    <th className="is-right">Costo unitario</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {!customStepItemPicker.providerId ? (
                    <tr>
                      <td colSpan={6} className="empty-state">
                        Selecciona un proveedor activo para continuar.
                      </td>
                    </tr>
                  ) : !customStepItemPicker.priceListId ? (
                    <tr>
                      <td colSpan={6} className="empty-state">
                        {customStepItemPicker.loadingLists
                          ? "Cargando lista activa del proveedor..."
                          : customStepItemPicker.unavailableListMessage ||
                            "El proveedor seleccionado no tiene una lista activa disponible."}
                      </td>
                    </tr>
                  ) : customStepItemPicker.loading ? (
                    <tr>
                      <td colSpan={6} className="empty-state">
                        Cargando productos...
                      </td>
                    </tr>
                  ) : customStepItemPicker.results.length ? (
                    customStepItemPicker.results.map((item) => (
                      <tr key={item.id}>
                        <td>{item.code || "-"}</td>
                        <td>{item.description || "Sin descripcion"}</td>
                        <td>{item.priceListName || "-"}</td>
                        <td>{item.providerName || "-"}</td>
                        <td className="is-right">
                          {formatCurrency(
                            normalizePositiveNumber(
                              item.price,
                              normalizePositiveNumber(
                                item.unitCostWithDiscount,
                                0,
                              ),
                            ),
                            item.currencyCode || processingCurrencyCode,
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn-secondary processing-product-action-icon"
                            title="Seleccionar item"
                            aria-label="Seleccionar item"
                            onClick={() =>
                              applyCatalogProductToCustomStepItem(item)
                            }
                          >
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              aria-hidden="true"
                            >
                              <path d="m20 6-11 11-5-5" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="empty-state">
                        No se encontraron items con ese criterio.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="processing-stage-actions split">
              <button
                type="button"
                className="btn-secondary"
                onClick={closeCustomStepItemPicker}
              >
                Cerrar
              </button>
            </div>
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
            if (
              event.target === event.currentTarget &&
              !savingKickoffInvitation
            ) {
              setKickoffInvitationModalOpen(false);
            }
          }}
        >
          <div className="modal-dialog processing-invite-modal">
            <div className="accept-order-notification-header">
              <span>Kick Off interno</span>
              <h3 id="kickoff-internal-invite-title">Convocatoria interna</h3>
              <p>
                Revisa el correo que se enviara a los convocados y confirma el
                envio.
              </p>
            </div>

            <div className="processing-stage-grid two">
              <label className="field-group processing-stage-field full">
                <span>Asunto</span>
                <input
                  type="text"
                  value={kickoffInvitationDraft.inviteSubject}
                  readOnly
                  maxLength={240}
                />
              </label>
              <label className="field-group processing-stage-field full">
                <span>Mensaje</span>
                <textarea
                  rows={8}
                  value={kickoffInvitationDraft.inviteBodyTemplate}
                  readOnly
                />
              </label>
            </div>

            <div className="processing-stage-actions split">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setKickoffInvitationModalOpen(false)}
                disabled={savingKickoffInvitation}
              >
                Cancelar
              </button>
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
                {savingKickoffInvitation
                  ? "Enviando..."
                  : "Enviar convocatoria"}
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
