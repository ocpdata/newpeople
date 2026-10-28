import { useCallback, useEffect, useState } from "react";
import { api, getApiErrorMessage } from "../api";
import { API_BASE } from "./libraryModel";

const EMPTY_RESULT = {
  key: null,
  items: [],
  total: 0,
  page: 1,
  hasMore: false,
  error: "",
};

// Lista paginada en el servidor; `params` debe ser estable entre renders (useMemo).
export default function useAssetList(params, reloadToken = "") {
  const requestKey = JSON.stringify([params, reloadToken]);
  const [result, setResult] = useState(EMPTY_RESULT);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get(`${API_BASE}/assets`, { params: { ...params, page: 1 } })
      .then((response) => {
        if (cancelled) return;
        const data = response.data || {};
        setResult({
          key: requestKey,
          items: data.items || [],
          total: Number(data.total || 0),
          page: 1,
          hasMore: Boolean(data.hasMore),
          error: "",
        });
      })
      .catch((requestError) => {
        if (cancelled) return;
        setResult({
          ...EMPTY_RESULT,
          key: requestKey,
          error: getApiErrorMessage(
            requestError,
            "No fue posible cargar los materiales",
          ),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [params, requestKey]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const response = await api.get(`${API_BASE}/assets`, {
        params: { ...params, page: result.page + 1 },
      });
      const data = response.data || {};
      setResult((current) =>
        current.key !== requestKey
          ? current
          : {
              ...current,
              items: [...current.items, ...(data.items || [])],
              total: Number(data.total || current.total),
              page: current.page + 1,
              hasMore: Boolean(data.hasMore),
            },
      );
    } catch (requestError) {
      setResult((current) => ({
        ...current,
        error: getApiErrorMessage(
          requestError,
          "No fue posible cargar más materiales",
        ),
      }));
    } finally {
      setLoadingMore(false);
    }
  }, [params, requestKey, result.page]);

  const patchItem = useCallback((publicId, patch) => {
    setResult((current) => ({
      ...current,
      items: current.items.map((item) =>
        item.publicId === publicId ? { ...item, ...patch } : item,
      ),
    }));
  }, []);

  const removeItem = useCallback((publicId) => {
    setResult((current) => {
      const items = current.items.filter((item) => item.publicId !== publicId);
      return {
        ...current,
        items,
        total: Math.max(0, current.total - (current.items.length - items.length)),
      };
    });
  }, []);

  return {
    items: result.items,
    total: result.total,
    hasMore: result.hasMore,
    error: result.error,
    loading: result.key !== requestKey || loadingMore,
    isInitialLoad: result.key === null,
    loadMore,
    patchItem,
    removeItem,
  };
}
