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
  const [accountQuotationsModalAccount, setAccountQuotationsModalAccount] =
    useState(null);
  const [editAccountQuotations, setEditAccountQuotations] = useState([]);
  const [loadingAccountQuotations, setLoadingAccountQuotations] =
    useState(false);
  const [quotationModalStatusFilter, setQuotationModalStatusFilter] =
    useState("all");
  const [accountProposalsModalAccount, setAccountProposalsModalAccount] =
    useState(null);
  const [editAccountProposals, setEditAccountProposals] = useState([]);
  const [loadingAccountProposals, setLoadingAccountProposals] = useState(false);
  const [proposalModalStatusFilter, setProposalModalStatusFilter] =
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
      setEditAccountOpportunities(
        Array.isArray(opportunities) ? opportunities : [],
      );
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

  async function openAccountQuotationsModal(account, opportunityId) {
    const targetAccountId = Number(account?.id || 0);
    setEditAccountQuotations([]);
    setQuotationModalStatusFilter("all");
    setAccountQuotationsModalAccount(account);
    setLoadingAccountQuotations(true);
    try {
      let query = `/api/quotations?accountId=${account.id}`;
      if (opportunityId) {
        query += `&opportunityId=${opportunityId}`;
      }
      const { data: quotations } = await api.get(query);
      const safeQuotations = Array.isArray(quotations) ? quotations : [];
      const hasAccountInfo = safeQuotations.some(
        (quotation) =>
          Number(quotation?.accountId ?? quotation?.account_id ?? 0) > 0,
      );
      const scopedQuotations = hasAccountInfo
        ? safeQuotations.filter(
            (quotation) =>
              Number(quotation?.accountId ?? quotation?.account_id ?? 0) ===
              targetAccountId,
          )
        : safeQuotations;
      setEditAccountQuotations(scopedQuotations);
    } catch {
      setEditAccountQuotations([]);
    } finally {
      setLoadingAccountQuotations(false);
    }
  }

  function closeAccountQuotationsModal() {
    setAccountQuotationsModalAccount(null);
    setEditAccountQuotations([]);
    setQuotationModalStatusFilter("all");
  }

  async function openAccountProposalsModal(account) {
    const targetAccountId = Number(account?.id || 0);
    setEditAccountProposals([]);
    setProposalModalStatusFilter("all");
    setAccountProposalsModalAccount(account);
    setLoadingAccountProposals(true);
    try {
      const { data: proposals } = await api.get("/api/proposals");
      const safeProposals = Array.isArray(proposals) ? proposals : [];
      const hasAccountInfo = safeProposals.some(
        (proposal) =>
          Number(proposal?.accountId ?? proposal?.account_id ?? 0) > 0,
      );
      const scopedProposals = hasAccountInfo
        ? safeProposals.filter(
            (proposal) =>
              Number(proposal?.accountId ?? proposal?.account_id ?? 0) ===
              targetAccountId,
          )
        : safeProposals;
      setEditAccountProposals(scopedProposals);
    } catch {
      setEditAccountProposals([]);
    } finally {
      setLoadingAccountProposals(false);
    }
  }

  function closeAccountProposalsModal() {
    setAccountProposalsModalAccount(null);
    setEditAccountProposals([]);
    setProposalModalStatusFilter("all");
  }

  function getOpportunityStatusBadgeClass(opportunity) {
    const status = normalizeText(opportunity.activation_status);
    if (status === "activada") return "user-status-badge active";
    if (status === "pendiente de activacion")
      return "user-status-badge pending";
    return "user-status-badge inactive";
  }

  function getContactStatusBadgeClass(contact) {
    const status = normalizeText(contact.activation_status);
    if (status === "activado") return "user-status-badge active";
    if (status === "pendiente de activacion")
      return "user-status-badge pending";
    return "user-status-badge inactive";
  }

  function getQuotationStatusBadgeClass(quotation) {
    const status = normalizeText(
      quotation.latestStatusLabel ||
        quotation.latest_status_label ||
        quotation.latestStatusCode ||
        quotation.latest_status_code ||
        quotation.status ||
        quotation.status_code,
    );
    if (!status || status === "active" || status.includes("activa")) {
      return "user-status-badge active";
    }
    if (status === "inactive" || status.includes("desactiv")) {
      return "user-status-badge inactive";
    }
    return "user-status-badge pending";
  }

  function getProposalStatusBadgeClass(proposal) {
    const status = normalizeText(proposal.statusCode || proposal.status_code);
    if (
      !status ||
      status === "active" ||
      status === "ready" ||
      status === "draft"
    ) {
      return "user-status-badge active";
    }
    if (status === "archived" || status.includes("desactiv")) {
      return "user-status-badge inactive";
    }
    return "user-status-badge pending";
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
    accountQuotationsModalAccount,
    accountProposalsModalAccount,
    editAccountContacts,
    editAccountQuotations,
    editAccountProposals,
    loadingAccountContacts,
    loadingAccountQuotations,
    loadingAccountProposals,
    contactModalStatusFilter,
    quotationModalStatusFilter,
    proposalModalStatusFilter,
    setContactModalStatusFilter,
    setQuotationModalStatusFilter,
    setProposalModalStatusFilter,
    openAccountOppsModal,
    closeAccountOppsModal,
    openAccountContactsModal,
    closeAccountContactsModal,
    openAccountQuotationsModal,
    closeAccountQuotationsModal,
    openAccountProposalsModal,
    closeAccountProposalsModal,
    getOpportunityStatusBadgeClass,
    getContactStatusBadgeClass,
    getQuotationStatusBadgeClass,
    getProposalStatusBadgeClass,
  };
}
