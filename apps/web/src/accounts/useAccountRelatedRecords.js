import { useState } from "react";
import { api } from "../api";

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function useAccountRelatedRecords() {
  const [editAccountOpportunities, setEditAccountOpportunities] = useState([]);
  const [loadingAccountOpportunities, setLoadingAccountOpportunities] =
    useState(false);
  const [oppSectionStatusFilter, setOppSectionStatusFilter] = useState("all");
  const [oppSectionYearFilter, setOppSectionYearFilter] = useState(
    String(new Date().getFullYear()),
  );
  const [accountOppsModalAccount, setAccountOppsModalAccount] = useState(null);
  const [accountContactsModalAccount, setAccountContactsModalAccount] =
    useState(null);
  const [editAccountContacts, setEditAccountContacts] = useState([]);
  const [loadingAccountContacts, setLoadingAccountContacts] = useState(false);
  const [contactModalStatusFilter, setContactModalStatusFilter] =
    useState("all");

  async function openAccountOppsModal(account) {
    setOppSectionStatusFilter("all");
    setOppSectionYearFilter(String(new Date().getFullYear()));
    setEditAccountOpportunities([]);
    setAccountOppsModalAccount(account);
    setLoadingAccountOpportunities(true);
    try {
      const { data: opportunities } = await api.get(
        `/api/opportunities?accountId=${account.id}`,
      );
      setEditAccountOpportunities(Array.isArray(opportunities) ? opportunities : []);
    } catch {
      setEditAccountOpportunities([]);
    } finally {
      setLoadingAccountOpportunities(false);
    }
  }

  function closeAccountOppsModal() {
    setAccountOppsModalAccount(null);
    setEditAccountOpportunities([]);
    setOppSectionStatusFilter("all");
    setOppSectionYearFilter(String(new Date().getFullYear()));
  }

  async function openAccountContactsModal(account) {
    setEditAccountContacts([]);
    setContactModalStatusFilter("all");
    setAccountContactsModalAccount(account);
    setLoadingAccountContacts(true);
    try {
      const { data: contacts } = await api.get(
        `/api/contacts?accountId=${account.id}`,
      );
      setEditAccountContacts(Array.isArray(contacts) ? contacts : []);
    } catch {
      setEditAccountContacts([]);
    } finally {
      setLoadingAccountContacts(false);
    }
  }

  function closeAccountContactsModal() {
    setAccountContactsModalAccount(null);
    setEditAccountContacts([]);
    setContactModalStatusFilter("all");
  }

  function getOpportunityStatusBadgeClass(opportunity) {
    const status = normalizeText(opportunity.activation_status);
    if (status === "activada") return "user-status-badge active";
    if (status === "pendiente de activacion") return "user-status-badge pending";
    return "user-status-badge inactive";
  }

  function getContactStatusBadgeClass(contact) {
    const status = normalizeText(contact.activation_status);
    if (status === "activado") return "user-status-badge active";
    if (status === "pendiente de activacion") return "user-status-badge pending";
    return "user-status-badge inactive";
  }

  return {
    editAccountOpportunities,
    loadingAccountOpportunities,
    oppSectionStatusFilter,
    setOppSectionStatusFilter,
    oppSectionYearFilter,
    setOppSectionYearFilter,
    accountOppsModalAccount,
    accountContactsModalAccount,
    editAccountContacts,
    loadingAccountContacts,
    contactModalStatusFilter,
    setContactModalStatusFilter,
    openAccountOppsModal,
    closeAccountOppsModal,
    openAccountContactsModal,
    closeAccountContactsModal,
    getOpportunityStatusBadgeClass,
    getContactStatusBadgeClass,
  };
}