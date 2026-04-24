import { useMemo, useState } from "react";
import { api } from "../api";

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function useContactOpportunities() {
  const [editContactOpportunities, setEditContactOpportunities] = useState([]);
  const [loadingContactOpportunities, setLoadingContactOpportunities] =
    useState(false);
  const [contactOppSectionStatusFilter, setContactOppSectionStatusFilter] =
    useState("all");
  const [contactOppSectionYearFilter, setContactOppSectionYearFilter] =
    useState(String(new Date().getFullYear()));
  const [contactOppsModalContact, setContactOppsModalContact] = useState(null);

  function getOpportunityStatusBadgeClass(opportunity) {
    const status = normalizeText(opportunity.activation_status);
    if (status === "activada") return "user-status-badge active";
    if (status === "pendiente de activacion") return "user-status-badge pending";
    return "user-status-badge inactive";
  }

  async function openContactOppsModal(contact) {
    setContactOppSectionStatusFilter("all");
    setContactOppSectionYearFilter(String(new Date().getFullYear()));
    setEditContactOpportunities([]);
    setContactOppsModalContact(contact);
    setLoadingContactOpportunities(true);
    try {
      const { data: opportunities } = await api.get(
        `/api/opportunities?contactId=${contact.id}`,
      );
      setEditContactOpportunities(Array.isArray(opportunities) ? opportunities : []);
    } catch {
      setEditContactOpportunities([]);
    } finally {
      setLoadingContactOpportunities(false);
    }
  }

  function closeContactOppsModal() {
    setContactOppsModalContact(null);
    setEditContactOpportunities([]);
    setContactOppSectionStatusFilter("all");
    setContactOppSectionYearFilter(String(new Date().getFullYear()));
  }

  const opportunityYears = useMemo(
    () =>
      [
        ...new Set(
          editContactOpportunities
            .map((opportunity) =>
              opportunity.close_date
                ? new Date(opportunity.close_date).getFullYear()
                : null,
            )
            .filter(Boolean),
        ),
      ].sort((left, right) => right - left),
    [editContactOpportunities],
  );

  const visibleContactOpportunities = useMemo(
    () =>
      editContactOpportunities.filter((opportunity) => {
        if (
          contactOppSectionStatusFilter !== "all" &&
          normalizeText(opportunity.activation_status) !==
            normalizeText(contactOppSectionStatusFilter)
        ) {
          return false;
        }

        if (contactOppSectionYearFilter !== "all" && opportunity.close_date) {
          return (
            String(new Date(opportunity.close_date).getFullYear()) ===
            contactOppSectionYearFilter
          );
        }

        if (contactOppSectionYearFilter !== "all" && !opportunity.close_date) {
          return false;
        }

        return true;
      }),
    [
      editContactOpportunities,
      contactOppSectionStatusFilter,
      contactOppSectionYearFilter,
    ],
  );

  return {
    editContactOpportunities,
    loadingContactOpportunities,
    contactOppSectionStatusFilter,
    setContactOppSectionStatusFilter,
    contactOppSectionYearFilter,
    setContactOppSectionYearFilter,
    contactOppsModalContact,
    opportunityYears,
    visibleContactOpportunities,
    getOpportunityStatusBadgeClass,
    openContactOppsModal,
    closeContactOppsModal,
  };
}