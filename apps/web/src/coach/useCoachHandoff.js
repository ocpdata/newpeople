import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, getApiErrorMessage } from "../api";

export function useCoachHandoff({ module }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const token = String(searchParams.get("coachDraft") || "").trim();
  const [handoff, setHandoff] = useState(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState("");
  const requestKeyRef = useRef("");

  const clearFromUrl = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("coachDraft");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!token) {
      setHandoff(null);
      setLoading(false);
      setError("");
      requestKeyRef.current = "";
      return;
    }
    const requestKey = `${module}:${token}`;
    if (requestKeyRef.current === requestKey) return;
    requestKeyRef.current = requestKey;
    let cancelled = false;
    setLoading(true);
    setError("");
    api
      .get(
        `/api/mi-agent/coach/handoffs/${encodeURIComponent(token)}?module=${encodeURIComponent(module)}`,
      )
      .then(({ data }) => {
        if (!cancelled) setHandoff(data?.handoff || null);
      })
      .catch((requestError) => {
        if (!cancelled) {
          setHandoff(null);
          setError(
            getApiErrorMessage(
              requestError,
              "No fue posible recuperar el borrador del Coach",
            ),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [module, token]);

  const complete = useCallback(
    async ({ entityType, entityId, result = {} }) => {
      if (!token) return null;
      const response = await api.post(
        `/api/mi-agent/coach/handoffs/${encodeURIComponent(token)}/complete`,
        { module, entityType, entityId, result },
      );
      setHandoff(null);
      clearFromUrl();
      return response.data?.operation || null;
    },
    [clearFromUrl, module, token],
  );

  const cancel = useCallback(
    async (reason) => {
      if (!token) return null;
      const response = await api.post(
        `/api/mi-agent/coach/handoffs/${encodeURIComponent(token)}/cancel`,
        { module, reason },
      );
      setHandoff(null);
      clearFromUrl();
      return response.data?.operation || null;
    },
    [clearFromUrl, module, token],
  );

  return {
    token,
    handoff,
    loading,
    error,
    complete,
    cancel,
    clearFromUrl,
  };
}
