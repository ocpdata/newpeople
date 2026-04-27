import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, getApiErrorMessage } from "../api";
import { usePersistedStatusFilter } from "../appFilters";

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function useOpportunitiesPage({
  currentUser,
  searchParams,
  setSearchParams,
}) {
  const [opportunities, setOpportunities] = useState([]);
  const [opportunityStatusFilter, setOpportunityStatusFilterState] =
    usePersistedStatusFilter("crm.opportunities.statusFilter");
  const [opportunityQuery, setOpportunityQueryState] = useState("");
  const [opportunitySortField, setOpportunitySortField] = useState("id");
  const [opportunitySortDirection, setOpportunitySortDirection] =
    useState("asc");
  const [opportunitiesPerPage, setOpportunitiesPerPageState] = useState(10);
  const [opportunitiesPage, setOpportunitiesPage] = useState(1);
  const [showOpportunityModal, setShowOpportunityModal] = useState(false);
  const [editingOpportunityId, setEditingOpportunityId] = useState(null);
  const [editOpportunityAudit, setEditOpportunityAudit] = useState(null);
  const [commercialContext, setCommercialContext] = useState(null);
  const [commercialStageViewsById, setCommercialStageViewsById] = useState({});
  const [draftStageAction, setDraftStageAction] = useState(null);
  const [selectedCommercialStageId, setSelectedCommercialStageId] =
    useState("");
  const [loadingCommercialStageView, setLoadingCommercialStageView] =
    useState(false);
  const [commercialCloseReason, setCommercialCloseReason] = useState("");
  const [pendingCommercialCloseAction, setPendingCommercialCloseAction] =
    useState(null);
  const [showCommercialCloseModal, setShowCommercialCloseModal] =
    useState(false);
  const [showCommercialStatusReasonModal, setShowCommercialStatusReasonModal] =
    useState(false);
  const [commercialCloseModalState, setCommercialCloseModalState] = useState({
    statusCode: "",
    reason: "",
  });
  const [showStageBypassModal, setShowStageBypassModal] = useState(false);
  const [stageBypassReason, setStageBypassReason] = useState("");
  const [openOpportunityMenuId, setOpenOpportunityMenuId] = useState(null);
  const [savingOpportunity, setSavingOpportunity] = useState(false);
  const [savingCommercialAction, setSavingCommercialAction] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const explicitOpportunityPermissions = useMemo(
    () => new Set(currentUser?.permissions || []),
    [currentUser],
  );
  const canCreateOrRequestOpportunities =
    explicitOpportunityPermissions.has("oportunidades.create") ||
    explicitOpportunityPermissions.has("oportunidades.request");
  const canChangeOpportunityActivationStatus =
    explicitOpportunityPermissions.has("oportunidades.create");
  const [catalogs, setCatalogs] = useState({
    accounts: [],
    contacts: [],
    sellerUsers: [],
    presalesUsers: [],
    businessLines: [],
    stages: [],
    statuses: [],
    commercialStatuses: [],
  });
  const [form, setForm] = useState({
    name: "",
    amountUsd: "",
    accountId: "",
    closeDate: "",
    contactId: "",
    salesStageId: "",
    businessLineId: "",
    sellerUserId: "",
    presalesUserId: "",
    activationStatusId: "",
  });
  const openEditOpportunityModalRef = useRef(null);

  function findCatalogIdByCode(options, expectedCode) {
    const target = normalizeText(expectedCode);
    const found = options.find(
      (option) => normalizeText(option.code) === target,
    );
    return found ? String(found.id) : "";
  }

  async function load() {
    try {
      const [
        opportunitiesRes,
        accountsRes,
        contactsRes,
        sellerUsersRes,
        presalesUsersRes,
        businessLinesRes,
        stagesRes,
        statusesRes,
        commercialStatusesRes,
      ] = await Promise.all([
        api.get("/api/opportunities"),
        api.get("/api/catalogs/opportunity-accounts"),
        api.get("/api/catalogs/opportunity-contacts"),
        api.get("/api/catalogs/opportunity-seller-users"),
        api.get("/api/catalogs/opportunity-presales-users"),
        api.get("/api/catalogs/opportunity-business-lines"),
        api.get("/api/catalogs/opportunity-sales-stages"),
        api.get("/api/catalogs/opportunity-activation-statuses"),
        api.get("/api/catalogs/opportunity-commercial-statuses"),
      ]);

      setOpportunities(opportunitiesRes.data || []);
      setCatalogs({
        accounts: accountsRes.data || [],
        contacts: contactsRes.data || [],
        sellerUsers: sellerUsersRes.data || [],
        presalesUsers: presalesUsersRes.data || [],
        businessLines: businessLinesRes.data || [],
        stages: stagesRes.data || [],
        statuses: statusesRes.data || [],
        commercialStatuses: commercialStatusesRes.data || [],
      });
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible cargar oportunidades"));
    }
  }

  function buildDefaultOpportunityForm() {
    const defaultSellerUserId =
      (currentUser?.roles || []).some(
        (role) => normalizeText(role.name) === "vendedor",
      ) &&
      catalogs.sellerUsers.some(
        (user) => Number(user.id) === Number(currentUser?.id),
      )
        ? String(currentUser.id)
        : "";

    return {
      name: "",
      amountUsd: "",
      accountId: "",
      closeDate: "",
      contactId: "",
      salesStageId: findCatalogIdByCode(catalogs.stages, "contacto_inicial"),
      businessLineId: "",
      sellerUserId: defaultSellerUserId,
      presalesUserId: "",
      activationStatusId: findCatalogIdByCode(
        catalogs.statuses,
        "pendiente_activacion",
      ),
    };
  }

  function buildDefaultCommercialContext() {
    const defaultStage = catalogs.stages.find(
      (stage) => normalizeText(stage.code) === "contacto_inicial",
    );
    const defaultCommercialStatus = catalogs.commercialStatuses.find(
      (status) => normalizeText(status.code) === "en_proceso",
    );

    return {
      salesStage: defaultStage
        ? {
            id: Number(defaultStage.id),
            code: String(defaultStage.code),
            name: String(defaultStage.name),
            order: Number(defaultStage.stage_order || 0),
          }
        : null,
      currentSalesStage: defaultStage
        ? {
            id: Number(defaultStage.id),
            code: String(defaultStage.code),
            name: String(defaultStage.name),
            order: Number(defaultStage.stage_order || 0),
          }
        : null,
      commercialStatus: defaultCommercialStatus
        ? {
            id: Number(defaultCommercialStatus.id),
            code: String(defaultCommercialStatus.code),
            name: String(defaultCommercialStatus.name),
            closedAt: null,
            closeReason: null,
          }
        : null,
      isSelectedStageCurrent: true,
      stages: defaultStage
        ? catalogs.stages.map((stage) => ({
            id: Number(stage.id),
            code: String(stage.code || ""),
            name: String(stage.name || ""),
            order: Number(stage.stage_order || 0),
            isCurrent: Number(stage.id) === Number(defaultStage.id),
            isSelected: Number(stage.id) === Number(defaultStage.id),
            isPast: false,
            isFuture:
              Number(stage.stage_order || 0) >
              Number(defaultStage.stage_order || 0),
            isClosed: false,
          }))
        : [],
      answers: [],
    };
  }

  function isCommercialOpportunityClosed(statusValue) {
    const normalized = normalizeText(statusValue);
    return (
      normalized === "ganada" ||
      normalized === "perdida" ||
      normalized === "anulada"
    );
  }

  const normalizeCommercialContext = useCallback((data) => {
    if (!data) return null;
    const normalizedSalesStage = data.salesStage
      ? {
          id: Number(data.salesStage.id),
          code: String(data.salesStage.code || ""),
          name: String(data.salesStage.name || ""),
          order: Number(
            data.salesStage.order || data.salesStage.stage_order || 0,
          ),
        }
      : null;
    const normalizedCurrentSalesStage = data.currentSalesStage
      ? {
          id: Number(data.currentSalesStage.id),
          code: String(data.currentSalesStage.code || ""),
          name: String(data.currentSalesStage.name || ""),
          order: Number(
            data.currentSalesStage.order ||
              data.currentSalesStage.stage_order ||
              0,
          ),
        }
      : normalizedSalesStage;
    const normalizedStages = Array.isArray(data.stages)
      ? data.stages.map((stage) => ({
          id: Number(stage.id),
          code: String(stage.code || ""),
          name: String(stage.name || ""),
          order: Number(stage.order || stage.stage_order || 0),
          isCurrent: Boolean(stage.isCurrent),
          isSelected: Boolean(stage.isSelected),
          isPast: Boolean(stage.isPast),
          isFuture: Boolean(stage.isFuture),
          isClosed: Boolean(stage.isClosed),
        }))
      : [];
    const normalizedCommercialStatusCode = normalizeText(
      data.commercialStatus?.code,
    );

    return {
      salesStage: normalizedSalesStage,
      currentSalesStage: normalizedCurrentSalesStage,
      bypassInfo: data.bypassInfo
        ? {
            isBypassed: Boolean(data.bypassInfo.isBypassed),
            reason: data.bypassInfo.reason || null,
          }
        : {
            isBypassed: false,
            reason: null,
          },
      commercialStatus: data.commercialStatus
        ? {
            id: Number(data.commercialStatus.id),
            code: String(data.commercialStatus.code || ""),
            name: String(data.commercialStatus.name || ""),
            closedAt: data.commercialStatus.closedAt || null,
            closeReason: data.commercialStatus.closeReason || null,
          }
        : null,
      isSelectedStageCurrent:
        data.isSelectedStageCurrent !== undefined
          ? Boolean(data.isSelectedStageCurrent)
          : Number(normalizedSalesStage?.id) ===
            Number(normalizedCurrentSalesStage?.id),
      stages:
        normalizedStages.length > 0
          ? normalizedStages
          : normalizedSalesStage
            ? [
                {
                  ...normalizedSalesStage,
                  isCurrent: true,
                  isSelected: true,
                  isPast: false,
                  isFuture: false,
                  isClosed:
                    normalizedCommercialStatusCode === "ganada" ||
                    normalizedCommercialStatusCode === "perdida" ||
                    normalizedCommercialStatusCode === "anulada",
                },
              ]
            : [],
      answers: Array.isArray(data.answers)
        ? data.answers.map((answer) => ({
            ...answer,
            question_id: Number(answer.question_id),
            answer_value:
              answer.answer_value === null || answer.answer_value === undefined
                ? ""
                : String(answer.answer_value),
          }))
        : [],
    };
  }, []);

  function buildCommercialContextForDraftStage(
    baseContext,
    { currentStageId, selectedStageId = currentStageId },
  ) {
    if (!baseContext) return null;

    const currentStage =
      baseContext.stages.find(
        (stage) => Number(stage.id) === Number(currentStageId),
      ) ||
      baseContext.currentSalesStage ||
      baseContext.salesStage;
    const selectedStage =
      baseContext.stages.find(
        (stage) => Number(stage.id) === Number(selectedStageId),
      ) ||
      baseContext.salesStage ||
      currentStage;
    const currentOrder = Number(currentStage?.order || 0);

    return {
      ...baseContext,
      salesStage: selectedStage
        ? {
            id: Number(selectedStage.id),
            code: String(selectedStage.code || ""),
            name: String(selectedStage.name || ""),
            order: Number(selectedStage.order || 0),
          }
        : null,
      currentSalesStage: currentStage
        ? {
            id: Number(currentStage.id),
            code: String(currentStage.code || ""),
            name: String(currentStage.name || ""),
            order: Number(currentStage.order || 0),
          }
        : null,
      bypassInfo: baseContext.bypassInfo
        ? {
            isBypassed: Boolean(baseContext.bypassInfo.isBypassed),
            reason: baseContext.bypassInfo.reason || null,
          }
        : {
            isBypassed: false,
            reason: null,
          },
      isSelectedStageCurrent:
        Number(selectedStage?.id) === Number(currentStage?.id),
      stages: (baseContext.stages || []).map((stage) => ({
        ...stage,
        isCurrent: Number(stage.id) === Number(currentStage?.id),
        isSelected: Number(stage.id) === Number(selectedStage?.id),
        isPast: Number(stage.order || 0) < currentOrder,
        isFuture: Number(stage.order || 0) > currentOrder,
      })),
    };
  }

  function formatDateTime(value) {
    if (!value) return "No registrado";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "No registrado";
    return date.toLocaleString("es-ES");
  }

  function formatCloseDate(value) {
    if (!value) return "-";
    const datePart = String(value).split("T")[0];
    const [year, month, day] = datePart.split("-");
    if (!year || !month || !day) return value;
    return `${day.padStart(2, "0")}/${month.padStart(2, "0")}/${year.slice(-2)}`;
  }

  const formatOpportunityAmountInput = useCallback((value) => {
    const rawValue = String(value || "")
      .replace(/,/g, "")
      .replace(/[^\d.]/g, "");
    if (!rawValue) return "";

    const hasDecimal = rawValue.includes(".");
    const [integerPartRaw, ...decimalRest] = rawValue.split(".");
    const decimalPart = decimalRest.join("");
    const integerPartNormalized =
      integerPartRaw.replace(/^0+(?=\d)/, "") || "0";
    const formattedInteger = integerPartNormalized.replace(
      /\B(?=(\d{3})+(?!\d))/g,
      ",",
    );

    if (!hasDecimal) return formattedInteger;
    return `${formattedInteger}.${decimalPart}`;
  }, []);

  function parseOpportunityAmountInput(value) {
    return Number(String(value || "").replace(/,/g, ""));
  }

  function getOpportunityStatusLabel(opportunity) {
    return opportunity.activation_status || "-";
  }

  function getOpportunityCommercialStatusLabel(opportunity) {
    return opportunity.commercial_status || "-";
  }

  function isOpportunityActive(opportunity) {
    return normalizeText(opportunity.activation_status) === "activada";
  }

  function isOpportunityPending(opportunity) {
    return (
      normalizeText(opportunity.activation_status) === "pendiente de activacion"
    );
  }

  function isOpportunityInactive(opportunity) {
    return normalizeText(opportunity.activation_status) === "desactivada";
  }

  function getOpportunityStatusBadgeClass(opportunity) {
    if (isOpportunityActive(opportunity)) {
      return "user-status-badge active";
    }
    if (isOpportunityPending(opportunity)) {
      return "user-status-badge pending";
    }
    return "user-status-badge inactive";
  }

  function getOpportunityStatusIconBadgeClass(statusValue) {
    if (normalizeText(statusValue) === "activada") {
      return "status-icon-badge active";
    }
    if (normalizeText(statusValue) === "pendiente de activacion") {
      return "status-icon-badge pending";
    }
    return "status-icon-badge inactive";
  }

  function getCommercialStatusBadgeClass(statusValue) {
    const normalized = normalizeText(statusValue);
    if (normalized === "en_proceso" || normalized === "en proceso") {
      return "user-status-badge pending";
    }
    if (normalized === "ganada") {
      return "user-status-badge won";
    }
    if (normalized === "perdida") {
      return "user-status-badge lost";
    }
    if (normalized === "anulada") {
      return "user-status-badge canceled";
    }
    return "user-status-badge inactive";
  }

  function getCommercialStatusIconBadgeClass(statusValue) {
    const normalized = normalizeText(statusValue);
    if (normalized === "en_proceso" || normalized === "en proceso") {
      return "status-icon-badge pending";
    }
    if (normalized === "ganada") {
      return "status-icon-badge won";
    }
    if (normalized === "perdida") {
      return "status-icon-badge lost";
    }
    if (normalized === "anulada") {
      return "status-icon-badge canceled";
    }
    return "status-icon-badge inactive";
  }

  function isCommercialOpportunityWaiting(statusValue) {
    return normalizeText(statusValue) === "waiting";
  }

  function resetCommercialDraftState() {
    setCommercialContext(null);
    setCommercialStageViewsById({});
    setDraftStageAction(null);
    setSelectedCommercialStageId("");
    setLoadingCommercialStageView(false);
    setCommercialCloseReason("");
    setPendingCommercialCloseAction(null);
    setShowCommercialCloseModal(false);
    setShowCommercialStatusReasonModal(false);
    setCommercialCloseModalState({ statusCode: "", reason: "" });
    setShowStageBypassModal(false);
    setStageBypassReason("");
  }

  function seedCommercialDraftState(baseContext) {
    setCommercialContext(baseContext);
    setCommercialStageViewsById({});
    setDraftStageAction(null);
    setSelectedCommercialStageId(
      baseContext?.salesStage?.id ? String(baseContext.salesStage.id) : "",
    );
    setLoadingCommercialStageView(false);
    setCommercialCloseReason("");
    setPendingCommercialCloseAction(null);
    setShowCommercialCloseModal(false);
    setCommercialCloseModalState({ statusCode: "", reason: "" });
    setShowStageBypassModal(false);
    setStageBypassReason("");
  }

  function openCreateOpportunityModal() {
    setError("");
    setSuccess("");
    setEditingOpportunityId(null);
    setEditOpportunityAudit(null);
    const defaultCommercialContext = buildDefaultCommercialContext();
    seedCommercialDraftState(defaultCommercialContext);
    setForm(buildDefaultOpportunityForm());
    setShowOpportunityModal(true);
  }

  const hydrateOpportunityModal = useCallback(
    async (opportunityId) => {
      const [{ data }, { data: commercialData }] = await Promise.all([
        api.get(`/api/opportunities/${opportunityId}`),
        api.get(`/api/opportunities/${opportunityId}/commercial-context`),
      ]);

      setForm({
        name: data.name || "",
        amountUsd:
          data.amount_usd === null || data.amount_usd === undefined
            ? ""
            : formatOpportunityAmountInput(String(data.amount_usd)),
        accountId: String(data.account_id || ""),
        closeDate: data.close_date ? String(data.close_date).slice(0, 10) : "",
        contactId: String(data.contact_id || ""),
        salesStageId: String(data.sales_stage_id || ""),
        businessLineId: String(data.business_line_id || ""),
        sellerUserId: String(data.seller_user_id || ""),
        presalesUserId: data.presales_user_id
          ? String(data.presales_user_id)
          : "",
        activationStatusId: String(data.activation_status_id || ""),
      });
      setEditOpportunityAudit({
        createdByName: data.created_by_name || "",
        createdAt: data.created_at || "",
        updatedByName: data.updated_by_name || "",
        updatedAt: data.updated_at || "",
        activationStatus: data.activation_status || "",
        commercialStatus: data.commercial_status || "",
      });
      const normalizedCommercialContext =
        normalizeCommercialContext(commercialData);
      setCommercialContext(normalizedCommercialContext);
      setDraftStageAction(null);
      setCommercialStageViewsById(
        normalizedCommercialContext?.salesStage?.id
          ? {
              [String(normalizedCommercialContext.salesStage.id)]:
                normalizedCommercialContext,
            }
          : {},
      );
      setSelectedCommercialStageId(
        normalizedCommercialContext?.salesStage?.id
          ? String(normalizedCommercialContext.salesStage.id)
          : "",
      );
      setLoadingCommercialStageView(false);
      setCommercialCloseReason(
        normalizedCommercialContext?.commercialStatus?.closeReason || "",
      );
      setPendingCommercialCloseAction(null);
      setShowCommercialCloseModal(false);
      setCommercialCloseModalState({ statusCode: "", reason: "" });
      setShowStageBypassModal(false);
      setStageBypassReason("");
      setEditingOpportunityId(Number(opportunityId));
      setShowOpportunityModal(true);
    },
    [formatOpportunityAmountInput, normalizeCommercialContext],
  );

  const openEditOpportunityModal = useCallback(
    async (opportunityId) => {
      setError("");
      setSuccess("");
      try {
        await hydrateOpportunityModal(opportunityId);
      } catch (err) {
        setError(
          getApiErrorMessage(err, "No fue posible cargar la oportunidad"),
        );
      }
    },
    [hydrateOpportunityModal],
  );

  useEffect(() => {
    openEditOpportunityModalRef.current = openEditOpportunityModal;
  }, [openEditOpportunityModal]);

  function closeOpportunityModal() {
    if (savingOpportunity || savingCommercialAction) return;
    setShowOpportunityModal(false);
    setEditingOpportunityId(null);
    setEditOpportunityAudit(null);
    resetCommercialDraftState();
  }

  const filteredOpportunities = useMemo(
    () =>
      opportunities.filter((opportunity) => {
        if (opportunityStatusFilter === "all") return true;
        if (opportunityStatusFilter === "pending") {
          return isOpportunityPending(opportunity);
        }
        if (opportunityStatusFilter === "inactive") {
          return isOpportunityInactive(opportunity);
        }
        return isOpportunityActive(opportunity);
      }),
    [opportunities, opportunityStatusFilter],
  );

  const opportunityStatusCounts = useMemo(
    () =>
      opportunities.reduce(
        (totals, opportunity) => {
          if (isOpportunityPending(opportunity)) {
            totals.pending += 1;
            return totals;
          }
          if (isOpportunityInactive(opportunity)) {
            totals.inactive += 1;
            return totals;
          }
          totals.active += 1;
          return totals;
        },
        { active: 0, pending: 0, inactive: 0 },
      ),
    [opportunities],
  );

  const totalOpportunitiesCount =
    opportunityStatusCounts.active +
    opportunityStatusCounts.pending +
    opportunityStatusCounts.inactive;

  const sortedOpportunities = useMemo(() => {
    const list = [...filteredOpportunities];

    const readValue = (opportunity) => {
      if (opportunitySortField === "id") return Number(opportunity.id) || 0;
      if (opportunitySortField === "nombre")
        return String(opportunity.name || "");
      if (opportunitySortField === "cuenta") {
        return String(opportunity.account_name || "");
      }
      if (opportunitySortField === "vendedor") {
        return String(opportunity.seller_user_name || "");
      }
      if (opportunitySortField === "preventa") {
        return String(opportunity.presales_user_name || "");
      }
      if (opportunitySortField === "etapa") {
        return String(opportunity.sales_stage || "");
      }
      if (opportunitySortField === "estado_comercial") {
        return String(getOpportunityCommercialStatusLabel(opportunity));
      }
      if (opportunitySortField === "importe") {
        return Number(opportunity.amount_usd) || 0;
      }
      if (opportunitySortField === "cierre") {
        return String(opportunity.close_date || "");
      }
      if (opportunitySortField === "estado") {
        return String(getOpportunityStatusLabel(opportunity));
      }
      return "";
    };

    list.sort((left, right) => {
      const leftValue = readValue(left);
      const rightValue = readValue(right);

      let result = 0;
      if (typeof leftValue === "number" && typeof rightValue === "number") {
        result = leftValue - rightValue;
      } else {
        result = String(leftValue).localeCompare(String(rightValue), "es", {
          numeric: true,
          sensitivity: "base",
        });
      }

      return opportunitySortDirection === "asc" ? result : -result;
    });

    return list;
  }, [filteredOpportunities, opportunitySortField, opportunitySortDirection]);

  const visibleOpportunities = useMemo(() => {
    const query = opportunityQuery.trim().toLowerCase();
    if (!query) return sortedOpportunities;

    return sortedOpportunities.filter((opportunity) => {
      const haystack = [
        opportunity.id,
        opportunity.name,
        opportunity.account_name,
        opportunity.seller_user_name,
        opportunity.contact_name,
        opportunity.sales_stage,
        opportunity.business_line,
        opportunity.presales_user_name,
        opportunity.activation_status,
        opportunity.commercial_status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [sortedOpportunities, opportunityQuery]);

  const totalOpportunityPages = Math.max(
    1,
    Math.ceil(visibleOpportunities.length / opportunitiesPerPage),
  );
  const pagedOpportunities = visibleOpportunities.slice(
    (opportunitiesPage - 1) * opportunitiesPerPage,
    opportunitiesPage * opportunitiesPerPage,
  );

  function toggleOpportunitySort(field) {
    if (opportunitySortField === field) {
      setOpportunitySortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setOpportunitySortField(field);
    setOpportunitySortDirection("asc");
  }

  function getOpportunitySortArrow(field) {
    if (opportunitySortField !== field) return "↕";
    return opportunitySortDirection === "asc" ? "↑" : "↓";
  }

  const currentSalesStageName =
    catalogs.stages.find(
      (stage) => String(stage.id) === String(form.salesStageId),
    )?.name || "";

  const currentCommercialStage =
    commercialContext?.currentSalesStage ||
    commercialContext?.salesStage ||
    null;
  const selectedCommercialStage = commercialContext?.salesStage || null;
  const hasPendingStageChange = Boolean(
    draftStageAction &&
    Number(draftStageAction.fromStageId) !== Number(draftStageAction.toStageId),
  );
  const hasPendingCommercialClose = Boolean(pendingCommercialCloseAction);
  const canRetreatToSelectedStage = Boolean(
    selectedCommercialStage &&
    currentCommercialStage &&
    Number(selectedCommercialStage.order || 0) <
      Number(currentCommercialStage.order || 0),
  );
  const currentCommercialStageIndex = (
    commercialContext?.stages || []
  ).findIndex(
    (stage) => Number(stage.id) === Number(currentCommercialStage?.id),
  );
  const canBypassCurrentStage =
    currentCommercialStageIndex > -1 &&
    currentCommercialStageIndex < (commercialContext?.stages || []).length - 1;
  const hasImmediatePreviousStage =
    normalizeText(currentCommercialStage?.code) !== "contacto_inicial";

  const isSelectedCommercialStageReadOnly =
    Boolean(editingOpportunityId) &&
    Boolean(commercialContext) &&
    !commercialContext.isSelectedStageCurrent;

  const isCommercialFlowClosed = isCommercialOpportunityClosed(
    commercialContext?.commercialStatus?.code,
  );

  const currentCommercialStatusName =
    commercialContext?.commercialStatus?.name ||
    catalogs.commercialStatuses.find(
      (status) => normalizeText(status.code) === "en_proceso",
    )?.name ||
    "En proceso";
  const isHeaderCommercialFlowClosed = isCommercialOpportunityClosed(
    editOpportunityAudit?.commercialStatus,
  );
  const currentCommercialStatusCode =
    commercialContext?.commercialStatus?.code ||
    commercialContext?.commercialStatus?.name ||
    "";
  const displayedCommercialCloseReason =
    pendingCommercialCloseAction?.reason ||
    commercialContext?.commercialStatus?.closeReason ||
    "";
  const canOpenCommercialStatusReason = ["perdida", "anulada"].includes(
    normalizeText(currentCommercialStatusCode),
  );
  const pendingCommercialCloseStatusName = pendingCommercialCloseAction
    ? catalogs.commercialStatuses.find(
        (status) =>
          String(status.code) ===
          String(pendingCommercialCloseAction.statusCode),
      )?.name || pendingCommercialCloseAction.statusCode
    : "";

  function openCommercialStatusReasonModal() {
    if (!canOpenCommercialStatusReason) return;
    setShowCommercialStatusReasonModal(true);
  }

  function closeCommercialStatusReasonModal() {
    setShowCommercialStatusReasonModal(false);
  }

  function updateCommercialAnswer(questionId, nextValue) {
    setCommercialContext((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        answers: prev.answers.map((answer) =>
          Number(answer.question_id) === Number(questionId)
            ? { ...answer, answer_value: nextValue }
            : answer,
        ),
      };
    });
  }

  function buildStageAnswersPayload() {
    if (
      !commercialContext?.answers?.length ||
      !commercialContext.isSelectedStageCurrent
    ) {
      return [];
    }
    return commercialContext.answers
      .map((answer) => ({
        questionId: Number(answer.question_id),
        answerValue: String(answer.answer_value || "").trim(),
      }))
      .filter((answer) => answer.answerValue);
  }

  async function refreshOpportunityCommercialView() {
    if (!editingOpportunityId) return;
    await hydrateOpportunityModal(editingOpportunityId);
    await load();
  }

  async function handleCommercialStageSelect(salesStageId) {
    const nextStageId = String(salesStageId || "");
    if (!editingOpportunityId || !nextStageId) return;
    if (nextStageId === String(commercialContext?.salesStage?.id || "")) {
      setSelectedCommercialStageId(nextStageId);
      return;
    }

    setError("");
    setSuccess("");
    setSelectedCommercialStageId(nextStageId);

    const cachedStageView = commercialStageViewsById[nextStageId];
    const draftCurrentStageId = Number(
      form.salesStageId ||
        commercialContext?.currentSalesStage?.id ||
        nextStageId,
    );
    if (cachedStageView) {
      setCommercialContext(
        buildCommercialContextForDraftStage(cachedStageView, {
          currentStageId: draftCurrentStageId,
          selectedStageId: Number(nextStageId),
        }),
      );
      return;
    }

    setLoadingCommercialStageView(true);
    try {
      const { data } = await api.get(
        `/api/opportunities/${editingOpportunityId}/stage-view/${nextStageId}`,
      );
      const normalizedStageView = normalizeCommercialContext(data);
      setCommercialContext(
        buildCommercialContextForDraftStage(normalizedStageView, {
          currentStageId: draftCurrentStageId,
          selectedStageId: Number(nextStageId),
        }),
      );
      setCommercialStageViewsById((prev) => ({
        ...prev,
        [nextStageId]: normalizedStageView,
      }));
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible cargar la etapa seleccionada"),
      );
      setSelectedCommercialStageId(
        String(commercialContext?.salesStage?.id || ""),
      );
    } finally {
      setLoadingCommercialStageView(false);
    }
  }

  async function previewStageDraftChange({
    mode,
    reason = null,
    targetStageId = null,
  }) {
    const orderedStages = [...(commercialContext?.stages || [])].sort(
      (left, right) => Number(left.order || 0) - Number(right.order || 0),
    );
    const currentStageIndex = orderedStages.findIndex(
      (stage) => Number(stage.id) === Number(currentCommercialStage?.id),
    );
    if (currentStageIndex === -1) {
      setError("No fue posible determinar la etapa actual");
      return false;
    }

    const targetStage =
      mode === "advance" || mode === "bypass"
        ? orderedStages[currentStageIndex + 1] || null
        : targetStageId
          ? orderedStages.find(
              (stage) => Number(stage.id) === Number(targetStageId),
            ) || null
          : orderedStages[currentStageIndex - 1] || null;

    if (!targetStage) {
      setError(
        mode === "retreat"
          ? "La oportunidad ya esta en la primera etapa operativa"
          : "La oportunidad ya esta en la ultima etapa operativa",
      );
      return false;
    }

    if (
      mode === "retreat" &&
      Number(targetStage.order || 0) >=
        Number(currentCommercialStage?.order || 0)
    ) {
      setError("Selecciona una etapa anterior para regresar la oportunidad");
      return false;
    }

    const nextStageId = String(targetStage.id);
    const cachedStageView = commercialStageViewsById[nextStageId];

    setLoadingCommercialStageView(true);
    try {
      const normalizedStageView = cachedStageView
        ? cachedStageView
        : normalizeCommercialContext(
            (
              await api.get(
                `/api/opportunities/${editingOpportunityId}/stage-view/${nextStageId}`,
              )
            ).data,
          );

      if (!cachedStageView) {
        setCommercialStageViewsById((prev) => ({
          ...prev,
          [nextStageId]: normalizedStageView,
        }));
      }

      setForm((prev) => ({
        ...prev,
        salesStageId: nextStageId,
      }));
      setDraftStageAction({
        mode,
        fromStageId: Number(currentCommercialStage?.id),
        toStageId: Number(targetStage.id),
        reason: reason || null,
      });
      setSelectedCommercialStageId(nextStageId);
      setCommercialContext(
        buildCommercialContextForDraftStage(normalizedStageView, {
          currentStageId: Number(targetStage.id),
          selectedStageId: Number(targetStage.id),
        }),
      );
      setSuccess(
        `Cambio de etapa pendiente. Presiona Guardar cambios para grabar ${targetStage.name}.`,
      );
      return true;
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible preparar el cambio de etapa"),
      );
      return false;
    } finally {
      setLoadingCommercialStageView(false);
    }
  }

  async function saveCommercialAnswers({
    silentSuccess = false,
    requireAnswers = true,
  } = {}) {
    if (!editingOpportunityId || !commercialContext) return true;
    if (!commercialContext.isSelectedStageCurrent) {
      setError("Selecciona la etapa actual para editar respuestas");
      return false;
    }
    const answersPayload = buildStageAnswersPayload();
    if (!answersPayload.length) {
      if (!requireAnswers) {
        return true;
      }
      setError("Debes capturar al menos una respuesta para guardar la etapa");
      return false;
    }

    try {
      await api.post(
        `/api/opportunities/${editingOpportunityId}/stage-answers`,
        {
          answers: answersPayload,
        },
      );
      await refreshOpportunityCommercialView();
      if (!silentSuccess) {
        setSuccess("Respuestas de etapa guardadas");
      }
      return true;
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible guardar las respuestas de etapa",
        ),
      );
      return false;
    }
  }

  async function handleStageTransition(direction) {
    setError("");
    setSuccess("");
    if (hasPendingStageChange) {
      setError(
        "Ya hay un cambio de etapa pendiente. Presiona Guardar cambios o cancela la edición.",
      );
      return;
    }
    if (direction !== "retreat" && !commercialContext?.isSelectedStageCurrent) {
      setError("Selecciona la etapa actual para mover la oportunidad");
      return;
    }
    if (
      direction === "retreat" &&
      !canRetreatToSelectedStage &&
      !hasImmediatePreviousStage
    ) {
      setError("Selecciona una etapa anterior para regresar la oportunidad");
      return;
    }
    setSavingCommercialAction(direction);
    try {
      if (direction === "advance") {
        const saved = await saveCommercialAnswers({ silentSuccess: true });
        if (!saved) return;
      }
      await previewStageDraftChange({
        mode: direction,
        targetStageId:
          direction === "retreat" && canRetreatToSelectedStage
            ? Number(selectedCommercialStage?.id)
            : null,
      });
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible actualizar la etapa comercial"),
      );
    } finally {
      setSavingCommercialAction("");
    }
  }

  async function handleCurrentStageValidation() {
    setError("");
    setSuccess("");
    if (hasPendingStageChange) {
      setError("Guarda cambios antes de validar la nueva etapa seleccionada.");
      return;
    }
    if (hasPendingCommercialClose) {
      setError("Guarda cambios antes de validar la oportunidad cerrada.");
      return;
    }
    if (!commercialContext?.isSelectedStageCurrent) {
      setError("Selecciona la etapa actual para validarla");
      return;
    }
    setSavingCommercialAction("validate-current-stage");
    try {
      const saved = await saveCommercialAnswers({
        silentSuccess: true,
        requireAnswers: false,
      });
      if (!saved) return;

      const { data } = await api.post(
        `/api/opportunities/${editingOpportunityId}/validate-current-stage`,
        {},
      );

      await refreshOpportunityCommercialView();
      setSuccess(
        data?.message ||
          `Etapa ${currentCommercialStage?.name || "actual"} validada`,
      );
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible validar la etapa actual"),
      );
    } finally {
      setSavingCommercialAction("");
    }
  }

  async function handleStageBypass() {
    setError("");
    setSuccess("");
    if (hasPendingStageChange) {
      setError(
        "Ya hay un cambio de etapa pendiente. Presiona Guardar cambios o cancela la edición.",
      );
      return;
    }
    if (hasPendingCommercialClose) {
      setError(
        "Guarda cambios antes de intentar otra acción del proceso comercial.",
      );
      return;
    }
    if (!commercialContext?.isSelectedStageCurrent) {
      setError("Selecciona la etapa actual para bypasearla");
      return;
    }
    if (!canBypassCurrentStage) {
      setError("La oportunidad ya esta en la ultima etapa operativa");
      return;
    }

    setStageBypassReason("");
    setShowStageBypassModal(true);
  }

  function closeStageBypassModal() {
    if (savingCommercialAction === "stage-bypass") return;
    setShowStageBypassModal(false);
    setStageBypassReason("");
  }

  async function confirmStageBypass() {
    const reason = String(stageBypassReason || "").trim();
    if (!reason) {
      setError("Debes indicar un motivo para bypasear la etapa");
      return;
    }

    setError("");
    setSuccess("");
    setSavingCommercialAction("stage-bypass");
    try {
      await previewStageDraftChange({ mode: "bypass", reason });
      setShowStageBypassModal(false);
      setStageBypassReason("");
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible bypasear la etapa actual"),
      );
    } finally {
      setSavingCommercialAction("");
    }
  }

  async function handleCommercialClose(statusCode) {
    setError("");
    setSuccess("");
    if (hasPendingStageChange) {
      setError("Guarda cambios antes de cerrar comercialmente la oportunidad.");
      return;
    }
    if (!commercialContext?.isSelectedStageCurrent) {
      setError("Selecciona la etapa actual para cerrar comercialmente");
      return;
    }
    if (statusCode === "perdida" || statusCode === "anulada") {
      setCommercialCloseModalState({
        statusCode,
        reason:
          pendingCommercialCloseAction?.statusCode === statusCode
            ? pendingCommercialCloseAction.reason
            : "",
      });
      setShowCommercialCloseModal(true);
      return;
    }
    setSavingCommercialAction(statusCode);
    try {
      const payload = {
        statusCode,
        reason:
          statusCode === "perdida" || statusCode === "anulada"
            ? commercialCloseReason
            : null,
      };
      const { data } = await api.post(
        `/api/opportunities/${editingOpportunityId}/commercial-close`,
        payload,
      );
      await refreshOpportunityCommercialView();
      setSuccess(data?.message || "Cierre comercial actualizado");
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible cerrar comercialmente la oportunidad",
        ),
      );
    } finally {
      setSavingCommercialAction("");
    }
  }

  function closeCommercialCloseModal() {
    if (savingCommercialAction === "commercial-close-draft") return;
    setShowCommercialCloseModal(false);
    setCommercialCloseModalState({ statusCode: "", reason: "" });
  }

  function confirmCommercialCloseDraft() {
    const reason = String(commercialCloseModalState.reason || "").trim();
    if (!reason) {
      setError("Debes indicar un motivo para cerrar la oportunidad");
      return;
    }

    const statusCode = commercialCloseModalState.statusCode;
    const statusName =
      catalogs.commercialStatuses.find(
        (status) => String(status.code) === String(statusCode),
      )?.name || statusCode;

    setError("");
    setSuccess(
      `Cierre comercial pendiente como ${statusName}. Presiona Guardar cambios para grabarlo.`,
    );
    setPendingCommercialCloseAction({ statusCode, reason });
    setCommercialCloseReason(reason);
    setShowCommercialCloseModal(false);
    setCommercialCloseModalState({ statusCode: "", reason: "" });
  }

  async function saveOpportunity(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (!form.sellerUserId) {
      setError("Selecciona un vendedor");
      return;
    }

    setSavingOpportunity(true);
    try {
      if (
        editingOpportunityId &&
        commercialContext?.isSelectedStageCurrent &&
        !isCommercialFlowClosed &&
        !hasPendingStageChange &&
        !hasPendingCommercialClose &&
        buildStageAnswersPayload().length
      ) {
        const savedAnswers = await saveCommercialAnswers({
          silentSuccess: true,
        });
        if (!savedAnswers) {
          setSavingOpportunity(false);
          return;
        }
      }

      const payload = {
        name: form.name,
        amountUsd: parseOpportunityAmountInput(form.amountUsd),
        accountId: Number(form.accountId),
        closeDate: form.closeDate,
        contactId: Number(form.contactId),
        businessLineId: Number(form.businessLineId),
        sellerUserId: Number(form.sellerUserId),
        presalesUserId: form.presalesUserId
          ? Number(form.presalesUserId)
          : null,
        activationStatusId: Number(form.activationStatusId),
      };

      if (!editingOpportunityId) {
        payload.salesStageId = Number(form.salesStageId);
      } else if (form.salesStageId) {
        payload.salesStageId = Number(form.salesStageId);
      }

      if (editingOpportunityId && hasPendingStageChange) {
        payload.stageChangeMode = draftStageAction.mode;
        payload.stageChangeReason = draftStageAction.reason || null;
      }

      if (editingOpportunityId && hasPendingCommercialClose) {
        payload.commercialStatusCode = pendingCommercialCloseAction.statusCode;
        payload.commercialCloseReason = pendingCommercialCloseAction.reason;
      }

      const { data } = editingOpportunityId
        ? await api.put(`/api/opportunities/${editingOpportunityId}`, payload)
        : await api.post("/api/opportunities", payload);

      setSuccess(
        data?.message ||
          (editingOpportunityId
            ? "Oportunidad actualizada correctamente"
            : "Oportunidad creada correctamente"),
      );
      setShowOpportunityModal(false);
      setEditingOpportunityId(null);
      setEditOpportunityAudit(null);
      setCommercialContext(null);
      setCommercialStageViewsById({});
      setDraftStageAction(null);
      setSelectedCommercialStageId("");
      setCommercialCloseReason("");
      setPendingCommercialCloseAction(null);
      setShowCommercialCloseModal(false);
      setCommercialCloseModalState({ statusCode: "", reason: "" });
      setShowStageBypassModal(false);
      setStageBypassReason("");
      await load();
    } catch (err) {
      const fieldErrors = err?.response?.data?.errors?.fieldErrors;
      if (fieldErrors && typeof fieldErrors === "object") {
        const firstError = Object.entries(fieldErrors).find(
          ([, messages]) => Array.isArray(messages) && messages.length > 0,
        );
        if (firstError) {
          const [fieldName, messages] = firstError;
          setError(`${fieldName}: ${messages[0]}`);
          setSavingOpportunity(false);
          return;
        }
      }
      setError(
        getApiErrorMessage(err, "No fue posible guardar la oportunidad"),
      );
    } finally {
      setSavingOpportunity(false);
    }
  }

  function toggleOpportunityMenu(opportunityId) {
    setOpenOpportunityMenuId((prev) =>
      prev === opportunityId ? null : opportunityId,
    );
  }

  async function runOpportunityAction(action) {
    try {
      await action();
    } finally {
      setOpenOpportunityMenuId(null);
    }
  }

  async function updateOpportunityStatus(opportunity, statusCode) {
    setError("");
    setSuccess("");
    try {
      const { data } = await api.patch(
        `/api/opportunities/${opportunity.id}/status`,
        {
          statusCode,
        },
      );
      setSuccess(data?.message || "Estado de oportunidad actualizado");
      await load();
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible actualizar el estado de la oportunidad",
        ),
      );
    }
  }

  const contactOptions = useMemo(() => {
    if (!form.accountId) return [];
    return catalogs.contacts.filter(
      (contact) => Number(contact.account_id) === Number(form.accountId),
    );
  }, [catalogs.contacts, form.accountId]);

  useEffect(() => {
    if (!error && !success) return;
    const timeoutId = window.setTimeout(() => {
      setError("");
      setSuccess("");
    }, 4000);
    return () => window.clearTimeout(timeoutId);
  }, [error, success]);

  useEffect(() => {
    if (openOpportunityMenuId === null) return undefined;

    function handlePointerDown(event) {
      if (event.target.closest(".opportunities-kebab-wrap")) return;
      setOpenOpportunityMenuId(null);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [openOpportunityMenuId]);

  useEffect(() => {
    let cancelled = false;

    async function initializeOpportunities() {
      try {
        const [
          opportunitiesRes,
          accountsRes,
          contactsRes,
          sellerUsersRes,
          presalesUsersRes,
          businessLinesRes,
          stagesRes,
          statusesRes,
          commercialStatusesRes,
        ] = await Promise.all([
          api.get("/api/opportunities"),
          api.get("/api/catalogs/opportunity-accounts"),
          api.get("/api/catalogs/opportunity-contacts"),
          api.get("/api/catalogs/opportunity-seller-users"),
          api.get("/api/catalogs/opportunity-presales-users"),
          api.get("/api/catalogs/opportunity-business-lines"),
          api.get("/api/catalogs/opportunity-sales-stages"),
          api.get("/api/catalogs/opportunity-activation-statuses"),
          api.get("/api/catalogs/opportunity-commercial-statuses"),
        ]);

        if (cancelled) return;

        setOpportunities(opportunitiesRes.data || []);
        setCatalogs({
          accounts: accountsRes.data || [],
          contacts: contactsRes.data || [],
          sellerUsers: sellerUsersRes.data || [],
          presalesUsers: presalesUsersRes.data || [],
          businessLines: businessLinesRes.data || [],
          stages: stagesRes.data || [],
          statuses: statusesRes.data || [],
          commercialStatuses: commercialStatusesRes.data || [],
        });
      } catch (err) {
        if (!cancelled) {
          setError(
            getApiErrorMessage(err, "No fue posible cargar oportunidades"),
          );
        }
      }
    }

    void initializeOpportunities();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const editId = searchParams.get("edit");
    if (!editId) return;
    let cancelled = false;

    async function syncEditParam() {
      setSearchParams({}, { replace: true });
      if (cancelled) return;
      await openEditOpportunityModalRef.current?.(Number(editId));
    }

    void syncEditParam();

    return () => {
      cancelled = true;
    };
  }, [searchParams, setSearchParams]);

  function setOpportunityStatusFilter(value) {
    setOpportunitiesPage(1);
    setOpportunityStatusFilterState(value);
  }

  function setOpportunityQuery(value) {
    setOpportunitiesPage(1);
    setOpportunityQueryState(value);
  }

  function setOpportunitiesPerPage(value) {
    setOpportunitiesPage(1);
    setOpportunitiesPerPageState(value);
  }

  return {
    opportunityStatusFilter,
    setOpportunityStatusFilter,
    opportunityQuery,
    setOpportunityQuery,
    opportunitiesPerPage,
    setOpportunitiesPerPage,
    opportunitiesPage,
    setOpportunitiesPage,
    showOpportunityModal,
    editingOpportunityId,
    editOpportunityAudit,
    selectedCommercialStageId,
    loadingCommercialStageView,
    showCommercialCloseModal,
    showCommercialStatusReasonModal,
    commercialCloseModalState,
    setCommercialCloseModalState,
    showStageBypassModal,
    stageBypassReason,
    setStageBypassReason,
    openOpportunityMenuId,
    savingOpportunity,
    savingCommercialAction,
    error,
    success,
    canCreateOrRequestOpportunities,
    canChangeOpportunityActivationStatus,
    catalogs,
    form,
    setForm,
    visibleOpportunities,
    pagedOpportunities,
    opportunityStatusCounts,
    totalOpportunitiesCount,
    totalOpportunityPages,
    currentSalesStageName,
    currentCommercialStage,
    hasPendingStageChange,
    hasPendingCommercialClose,
    canRetreatToSelectedStage,
    canBypassCurrentStage,
    hasImmediatePreviousStage,
    isSelectedCommercialStageReadOnly,
    isCommercialFlowClosed,
    currentCommercialStatusName,
    isHeaderCommercialFlowClosed,
    displayedCommercialCloseReason,
    canOpenCommercialStatusReason,
    pendingCommercialCloseStatusName,
    commercialContext,
    contactOptions,
    formatDateTime,
    formatCloseDate,
    formatOpportunityAmountInput,
    getOpportunityStatusLabel,
    getOpportunityCommercialStatusLabel,
    isOpportunityActive,
    isOpportunityPending,
    isOpportunityInactive,
    getOpportunityStatusBadgeClass,
    getOpportunityStatusIconBadgeClass,
    getCommercialStatusBadgeClass,
    getCommercialStatusIconBadgeClass,
    openCreateOpportunityModal,
    openEditOpportunityModal,
    closeOpportunityModal,
    toggleOpportunitySort,
    getOpportunitySortArrow,
    openCommercialStatusReasonModal,
    closeCommercialStatusReasonModal,
    updateCommercialAnswer,
    handleCommercialStageSelect,
    handleCurrentStageValidation,
    handleStageBypass,
    closeStageBypassModal,
    confirmStageBypass,
    handleStageTransition,
    handleCommercialClose,
    closeCommercialCloseModal,
    confirmCommercialCloseDraft,
    saveOpportunity,
    toggleOpportunityMenu,
    runOpportunityAction,
    updateOpportunityStatus,
  };
}
