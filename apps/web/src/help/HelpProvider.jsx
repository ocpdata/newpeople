import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { HELP_ARTICLES, HELP_TOURS, resolveHelpRouteKey } from "./helpData";

const HelpContext = createContext(null);

function getStorageKey(userId) {
  return `newpeople.help.v1.${userId || "guest"}`;
}

function readHelpState(userId) {
  try {
    const key = getStorageKey(userId);
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return { completedTours: {} };
    }
    const parsed = JSON.parse(raw);
    return {
      completedTours:
        parsed && typeof parsed.completedTours === "object"
          ? parsed.completedTours
          : {},
    };
  } catch {
    return { completedTours: {} };
  }
}

export function HelpProvider({ currentUser, children }) {
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeTour, setActiveTour] = useState(null);
  const [completedTours, setCompletedTours] = useState({});

  const userId = currentUser?.id ? String(currentUser.id) : "guest";
  const routeKey = useMemo(
    () => resolveHelpRouteKey(location.pathname),
    [location.pathname],
  );

  useEffect(() => {
    const stored = readHelpState(userId);
    setCompletedTours(stored.completedTours || {});
  }, [userId]);

  useEffect(() => {
    try {
      const key = getStorageKey(userId);
      window.localStorage.setItem(
        key,
        JSON.stringify({
          completedTours,
        }),
      );
    } catch {
      // No-op when storage is unavailable.
    }
  }, [completedTours, userId]);

  useEffect(() => {
    setActiveTour(null);
  }, [location.pathname]);

  const routeTours = useMemo(
    () => HELP_TOURS.filter((tour) => tour.routeKey === routeKey),
    [routeKey],
  );

  const routeArticles = useMemo(
    () => HELP_ARTICLES.filter((article) => article.routeKey === routeKey),
    [routeKey],
  );

  const filteredArticles = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return routeArticles;
    }
    return routeArticles.filter((article) => {
      const bag = [article.title, article.summary, ...(article.tags || [])]
        .join(" ")
        .toLowerCase();
      return bag.includes(normalized);
    });
  }, [query, routeArticles]);

  const currentTour = useMemo(() => {
    if (!activeTour?.tourId) {
      return null;
    }
    return HELP_TOURS.find((tour) => tour.id === activeTour.tourId) || null;
  }, [activeTour]);

  const currentStep = useMemo(() => {
    if (!currentTour || !activeTour) {
      return null;
    }
    const idx = Number(activeTour.stepIndex || 0);
    return currentTour.steps[idx] || null;
  }, [activeTour, currentTour]);

  useEffect(() => {
    const selector = currentStep?.target;
    if (!selector) {
      return undefined;
    }

    const target = document.querySelector(selector);
    if (!target) {
      return undefined;
    }

    target.classList.add("help-tour-highlight");
    target.scrollIntoView({ behavior: "smooth", block: "center" });

    return () => {
      target.classList.remove("help-tour-highlight");
    };
  }, [currentStep]);

  function openHelp() {
    setIsOpen(true);
  }

  function closeHelp() {
    setIsOpen(false);
  }

  function toggleHelp() {
    setIsOpen((previous) => !previous);
  }

  function startTour(tourId) {
    const tour = HELP_TOURS.find((candidate) => candidate.id === tourId);
    if (!tour || !tour.steps?.length) {
      return;
    }
    setIsOpen(true);
    setActiveTour({ tourId, stepIndex: 0 });
  }

  function stopTour() {
    setActiveTour(null);
  }

  function nextStep() {
    if (!currentTour || !activeTour) {
      return;
    }
    const nextIndex = Number(activeTour.stepIndex || 0) + 1;
    if (nextIndex >= currentTour.steps.length) {
      setCompletedTours((previous) => ({
        ...previous,
        [currentTour.id]: true,
      }));
      setActiveTour(null);
      return;
    }
    setActiveTour({
      tourId: currentTour.id,
      stepIndex: nextIndex,
    });
  }

  function previousStep() {
    if (!currentTour || !activeTour) {
      return;
    }
    const previousIndex = Math.max(0, Number(activeTour.stepIndex || 0) - 1);
    setActiveTour({
      tourId: currentTour.id,
      stepIndex: previousIndex,
    });
  }

  const value = {
    isOpen,
    query,
    setQuery,
    routeKey,
    routeTours,
    routeArticles,
    filteredArticles,
    currentTour,
    currentStep,
    activeTour,
    completedTours,
    openHelp,
    closeHelp,
    toggleHelp,
    startTour,
    stopTour,
    nextStep,
    previousStep,
  };

  return <HelpContext.Provider value={value}>{children}</HelpContext.Provider>;
}

export function useHelp() {
  const context = useContext(HelpContext);
  if (!context) {
    throw new Error("useHelp must be used within a HelpProvider");
  }
  return context;
}
