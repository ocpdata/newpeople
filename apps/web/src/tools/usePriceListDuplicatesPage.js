import { useCallback, useEffect, useMemo, useState } from "react";
import { api, getApiErrorMessage } from "../api";

const EMPTY_FILTERS = {
  providerId: "",
  priceListId: "",
  normalizedCode: "",
  state: "",
  riskLevel: "",
  hasQuotationReferences: "",
  hasBundleReferences: "",
};

function buildQueryParams(filters) {
  const params = {};
  for (const [key, value] of Object.entries(filters || {})) {
    const normalizedValue = String(value || "").trim();
    if (!normalizedValue) continue;
    if (key === "hasQuotationReferences" || key === "hasBundleReferences") {
      params[key] = normalizedValue === "true";
      continue;
    }
    if ((key === "providerId" || key === "priceListId") && /^\d+$/.test(normalizedValue)) {
      params[key] = Number(normalizedValue);
      continue;
    }
    params[key] = normalizedValue;
  }
  return params;
}

export function usePriceListDuplicatesPage() {
  const [summary, setSummary] = useState(null);
  const [groups, setGroups] = useState([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [groupDetail, setGroupDetail] = useState(null);
  const [selectedGroupKey, setSelectedGroupKey] = useState("");
  const [selectedKeepCandidateId, setSelectedKeepCandidateId] = useState("");
  const [selectedDuplicateIds, setSelectedDuplicateIds] = useState([]);
  const [validation, setValidation] = useState(null);
  const [submittingAction, setSubmittingAction] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadSummary = useCallback(async () => {
    setLoadingSummary(true);
    try {
      const { data } = await api.get("/api/tools/price-list-duplicates/summary");
      setSummary(data?.summary || null);
    } catch (loadError) {
      setError(
        getApiErrorMessage(loadError, "No fue posible cargar el resumen de duplicados"),
      );
    } finally {
      setLoadingSummary(false);
    }
  }, []);

  const loadGroups = useCallback(async () => {
    setLoadingGroups(true);
    try {
      const { data } = await api.get("/api/tools/price-list-duplicates/groups", {
        params: buildQueryParams(filters),
      });
      setGroups(Array.isArray(data?.items) ? data.items : []);
    } catch (loadError) {
      setError(
        getApiErrorMessage(loadError, "No fue posible cargar los grupos duplicados"),
      );
    } finally {
      setLoadingGroups(false);
    }
  }, [filters]);

  const loadGroupDetail = useCallback(async (groupKey) => {
    if (!groupKey) {
      setGroupDetail(null);
      setSelectedGroupKey("");
      setSelectedKeepCandidateId("");
      setSelectedDuplicateIds([]);
      setValidation(null);
      return;
    }

    setLoadingDetail(true);
    setError("");
    try {
      const { data } = await api.get(
        `/api/tools/price-list-duplicates/groups/${encodeURIComponent(groupKey)}`,
      );
      const nextGroup = data?.group || null;
      setSelectedGroupKey(groupKey);
      setGroupDetail(nextGroup);
      setValidation(null);
      setSelectedKeepCandidateId(String(nextGroup?.keepCandidateId || ""));
      setSelectedDuplicateIds(
        Array.isArray(nextGroup?.items)
          ? nextGroup.items
              .filter((item) => Number(item.id) !== Number(nextGroup?.keepCandidateId || 0))
              .map((item) => Number(item.id))
          : [],
      );
    } catch (loadError) {
      setError(
        getApiErrorMessage(loadError, "No fue posible cargar el detalle del grupo"),
      );
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  const updateFilter = useCallback((field, value) => {
    setFilters((current) => ({ ...current, [field]: value }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
  }, []);

  const chooseKeepCandidate = useCallback((itemId) => {
    setSelectedKeepCandidateId(String(itemId));
    setSelectedDuplicateIds((current) => {
      const itemNumber = Number(itemId);
      const next = new Set(current.map((value) => Number(value)));
      next.delete(itemNumber);
      if (groupDetail?.items) {
        groupDetail.items.forEach((item) => {
          if (Number(item.id) !== itemNumber) {
            next.add(Number(item.id));
          }
        });
      }
      return Array.from(next);
    });
    setValidation(null);
  }, [groupDetail]);

  const toggleDuplicateSelection = useCallback((itemId) => {
    const itemNumber = Number(itemId);
    if (itemNumber === Number(selectedKeepCandidateId || 0)) {
      return;
    }
    setSelectedDuplicateIds((current) => {
      const set = new Set(current.map((value) => Number(value)));
      if (set.has(itemNumber)) {
        set.delete(itemNumber);
      } else {
        set.add(itemNumber);
      }
      return Array.from(set);
    });
    setValidation(null);
  }, [selectedKeepCandidateId]);

  const buildPayload = useCallback((mode = "archive_duplicates") => ({
    keepCandidateId: Number(selectedKeepCandidateId || 0),
    duplicateItemIds: selectedDuplicateIds.map((itemId) => Number(itemId)),
    mode,
  }), [selectedDuplicateIds, selectedKeepCandidateId]);

  const validateConsolidation = useCallback(async () => {
    if (!selectedGroupKey) return;
    setSubmittingAction("validate");
    setError("");
    setSuccess("");
    try {
      const { data } = await api.post(
        `/api/tools/price-list-duplicates/groups/${encodeURIComponent(selectedGroupKey)}/validate-consolidation`,
        buildPayload(),
      );
      setValidation(data || null);
      if (data?.valid) {
        setSuccess("Validacion completada. El grupo esta listo para consolidarse.");
      }
    } catch (validationError) {
      setValidation(null);
      setError(
        getApiErrorMessage(
          validationError,
          "No fue posible validar la consolidacion del grupo",
        ),
      );
    } finally {
      setSubmittingAction("");
    }
  }, [buildPayload, selectedGroupKey]);

  const executeAction = useCallback(async (mode) => {
    if (!selectedGroupKey) return;
    setSubmittingAction(mode);
    setError("");
    setSuccess("");
    try {
      const path =
        mode === "archive_duplicates"
          ? `/api/tools/price-list-duplicates/groups/${encodeURIComponent(selectedGroupKey)}/archive-duplicates`
          : `/api/tools/price-list-duplicates/groups/${encodeURIComponent(selectedGroupKey)}/consolidate`;
      const { data } = await api.post(path, buildPayload(mode));
      setSuccess(data?.message || "Operacion completada");
      await Promise.all([loadSummary(), loadGroups()]);
      await loadGroupDetail(selectedGroupKey);
    } catch (actionError) {
      const validationPayload = actionError?.response?.data?.validation || null;
      if (validationPayload) {
        setValidation(validationPayload);
      }
      setError(
        getApiErrorMessage(actionError, "No fue posible ejecutar la accion"),
      );
    } finally {
      setSubmittingAction("");
    }
  }, [buildPayload, loadGroupDetail, loadGroups, loadSummary, selectedGroupKey]);

  const totalActiveFilters = useMemo(
    () => Object.values(filters).filter((value) => String(value || "").trim()).length,
    [filters],
  );

  return {
    summary,
    groups,
    filters,
    loadingSummary,
    loadingGroups,
    loadingDetail,
    groupDetail,
    selectedGroupKey,
    selectedKeepCandidateId,
    selectedDuplicateIds,
    validation,
    submittingAction,
    error,
    success,
    totalActiveFilters,
    updateFilter,
    clearFilters,
    loadGroups,
    loadSummary,
    loadGroupDetail,
    chooseKeepCandidate,
    toggleDuplicateSelection,
    validateConsolidation,
    executeAction,
  };
}