import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

function buildModuleLabel(pathname) {
  const value = String(pathname || "").trim();
  if (!value || value === "/") return "dashboard";
  return value.replace(/^\//, "").split("/")[0] || "general";
}

export function buildBaseChatbotContext(pathname) {
  return {
    route: String(pathname || "/"),
    module: buildModuleLabel(pathname),
    viewType: "page",
    surface: "app_route",
    activeEntity: null,
    relatedEntities: {},
    visibleData: {},
    selection: {},
    uiState: {},
  };
}

function mergeChatbotContext(baseContext, nextContext) {
  const safeBase =
    baseContext && typeof baseContext === "object" ? baseContext : {};
  const safeNext =
    nextContext && typeof nextContext === "object" ? nextContext : {};

  return {
    ...safeBase,
    ...safeNext,
    activeEntity:
      safeNext.activeEntity === undefined
        ? safeBase.activeEntity || null
        : safeNext.activeEntity,
    relatedEntities: {
      ...(safeBase.relatedEntities || {}),
      ...(safeNext.relatedEntities || {}),
    },
    visibleData: {
      ...(safeBase.visibleData || {}),
      ...(safeNext.visibleData || {}),
    },
    selection: {
      ...(safeBase.selection || {}),
      ...(safeNext.selection || {}),
    },
    uiState: {
      ...(safeBase.uiState || {}),
      ...(safeNext.uiState || {}),
    },
  };
}

const ChatbotContextState = createContext(null);

export function ChatbotContextProvider({ pathname, children }) {
  const [registrations, setRegistrations] = useState({});

  const baseContext = useMemo(
    () => buildBaseChatbotContext(pathname),
    [pathname],
  );

  const registerContext = useCallback((sourceId, value, priority = 0) => {
    const safeSourceId = String(sourceId || "").trim();
    if (!safeSourceId) return;
    setRegistrations((current) => ({
      ...current,
      [safeSourceId]: {
        priority: Number(priority || 0),
        value: value && typeof value === "object" ? value : {},
      },
    }));
  }, []);

  const unregisterContext = useCallback((sourceId) => {
    const safeSourceId = String(sourceId || "").trim();
    if (!safeSourceId) return;
    setRegistrations((current) => {
      if (!current[safeSourceId]) return current;
      const next = { ...current };
      delete next[safeSourceId];
      return next;
    });
  }, []);

  const contextSnapshot = useMemo(() => {
    const entries = Object.values(registrations).sort(
      (left, right) => Number(left.priority || 0) - Number(right.priority || 0),
    );

    return entries.reduce(
      (accumulator, entry) => mergeChatbotContext(accumulator, entry.value),
      baseContext,
    );
  }, [baseContext, registrations]);

  const value = useMemo(
    () => ({ contextSnapshot, registerContext, unregisterContext }),
    [contextSnapshot, registerContext, unregisterContext],
  );

  return (
    <ChatbotContextState.Provider value={value}>
      {children}
    </ChatbotContextState.Provider>
  );
}

export function useChatbotContextState() {
  const value = useContext(ChatbotContextState);
  if (!value) {
    throw new Error(
      "useChatbotContextState must be used within ChatbotContextProvider",
    );
  }
  return value.contextSnapshot;
}

export function useChatbotContextRegistration(
  sourceId,
  contextValue,
  priority = 0,
  enabled = true,
) {
  const value = useContext(ChatbotContextState);
  if (!value) {
    throw new Error(
      "useChatbotContextRegistration must be used within ChatbotContextProvider",
    );
  }

  useEffect(() => {
    if (!enabled || !contextValue) {
      value.unregisterContext(sourceId);
      return undefined;
    }

    value.registerContext(sourceId, contextValue, priority);
    return () => {
      value.unregisterContext(sourceId);
    };
  }, [contextValue, enabled, priority, sourceId, value]);
}
