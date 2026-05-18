import { useEffect, useMemo, useState } from "react";
import { api, getApiErrorMessage } from "../api";

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function toDateTimeLocalValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function buildDefaultInteractionForm({ interactionTypes, interactionResults }) {
  return {
    interactionTypeId: interactionTypes[0]?.id
      ? String(interactionTypes[0].id)
      : "",
    resultId: interactionResults[0]?.id ? String(interactionResults[0].id) : "",
    title: "",
    summary: "",
    nextStep: "",
    occurredAt: toDateTimeLocalValue(new Date()),
    followUpAt: "",
    contactIds: [],
  };
}

function buildDefaultPromotionForm({
  interaction,
  contactOptions,
  businessLines,
  sellerUsers,
}) {
  const firstContactId =
    interaction?.contacts?.[0]?.id || contactOptions[0]?.id || "";
  return {
    name: interaction?.title || "",
    amountUsd: "",
    closeDate: "",
    contactId: firstContactId ? String(firstContactId) : "",
    businessLineId: businessLines[0]?.id ? String(businessLines[0].id) : "",
    sellerUserId: sellerUsers[0]?.id ? String(sellerUsers[0].id) : "",
    presalesUserId: "",
    documentPublicIds: Array.isArray(interaction?.documents)
      ? interaction.documents.map((document) => document.publicId)
      : [],
  };
}

function formatAmountInput(value) {
  const normalized = String(value || "").replace(/[^\d.,]/g, "");
  return normalized;
}

function parseAmountInput(value) {
  const normalized = String(value || "")
    .replace(/,/g, "")
    .trim();
  return normalized ? Number(normalized) : NaN;
}

export function useAccountInteractions({
  editingAccountId,
  isAccountModalOpen,
}) {
  const [interactionTypes, setInteractionTypes] = useState([]);
  const [interactionResults, setInteractionResults] = useState([]);
  const [accountContactOptions, setAccountContactOptions] = useState([]);
  const [promotionCatalogs, setPromotionCatalogs] = useState({
    businessLines: [],
    sellerUsers: [],
    presalesUsers: [],
  });
  const [accountInteractions, setAccountInteractions] = useState([]);
  const [loadingAccountInteractions, setLoadingAccountInteractions] =
    useState(false);
  const [showInteractionModal, setShowInteractionModal] = useState(false);
  const [editingInteractionId, setEditingInteractionId] = useState(null);
  const [interactionForm, setInteractionForm] = useState(
    buildDefaultInteractionForm({
      interactionTypes: [],
      interactionResults: [],
    }),
  );
  const [interactionDocuments, setInteractionDocuments] = useState([]);
  const [savingInteraction, setSavingInteraction] = useState(false);
  const [uploadingInteractionDocuments, setUploadingInteractionDocuments] =
    useState(false);
  const [deletingInteractionDocumentId, setDeletingInteractionDocumentId] =
    useState("");
  const [interactionTypeFilter, setInteractionTypeFilter] = useState("all");
  const [interactionResultFilter, setInteractionResultFilter] = useState("all");
  const [interactionQuery, setInteractionQuery] = useState("");
  const [showPromotionPanel, setShowPromotionPanel] = useState(false);
  const [promotionForm, setPromotionForm] = useState(
    buildDefaultPromotionForm({
      interaction: null,
      contactOptions: [],
      businessLines: [],
      sellerUsers: [],
    }),
  );
  const [promotingInteraction, setPromotingInteraction] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function loadAccountInteractionBase(accountId) {
    const [
      typesRes,
      resultsRes,
      contactsRes,
      interactionsRes,
      businessLinesRes,
      sellerUsersRes,
      presalesUsersRes,
    ] = await Promise.all([
      api.get("/api/catalogs/account-interaction-types"),
      api.get("/api/catalogs/account-interaction-results"),
      api.get(`/api/accounts/${accountId}/interactions/contact-options`),
      api.get(`/api/accounts/${accountId}/interactions`),
      api.get("/api/catalogs/opportunity-business-lines"),
      api.get("/api/catalogs/opportunity-seller-users"),
      api.get("/api/catalogs/opportunity-presales-users"),
    ]);

    setInteractionTypes(typesRes.data || []);
    setInteractionResults(resultsRes.data || []);
    setAccountContactOptions(contactsRes.data || []);
    setAccountInteractions(
      Array.isArray(interactionsRes.data?.items)
        ? interactionsRes.data.items
        : [],
    );
    setPromotionCatalogs({
      businessLines: businessLinesRes.data || [],
      sellerUsers: sellerUsersRes.data || [],
      presalesUsers: presalesUsersRes.data || [],
    });
  }

  async function refreshAccountInteractions() {
    if (!editingAccountId) return;
    const { data } = await api.get(
      `/api/accounts/${editingAccountId}/interactions`,
    );
    setAccountInteractions(Array.isArray(data?.items) ? data.items : []);
  }

  function closeInteractionModal() {
    if (
      savingInteraction ||
      promotingInteraction ||
      uploadingInteractionDocuments
    ) {
      return;
    }
    setShowInteractionModal(false);
    setEditingInteractionId(null);
    setInteractionDocuments([]);
    setShowPromotionPanel(false);
    setPromotionForm(
      buildDefaultPromotionForm({
        interaction: null,
        contactOptions: accountContactOptions,
        businessLines: promotionCatalogs.businessLines,
        sellerUsers: promotionCatalogs.sellerUsers,
      }),
    );
    setInteractionForm(
      buildDefaultInteractionForm({ interactionTypes, interactionResults }),
    );
  }

  async function openCreateInteractionModal() {
    setError("");
    setSuccess("");
    setEditingInteractionId(null);
    setInteractionDocuments([]);
    setShowPromotionPanel(false);
    setInteractionForm(
      buildDefaultInteractionForm({ interactionTypes, interactionResults }),
    );
    setShowInteractionModal(true);
  }

  async function openEditInteractionModal(interactionId) {
    if (!editingAccountId || !interactionId) return;

    setError("");
    setSuccess("");
    try {
      const { data } = await api.get(
        `/api/accounts/${editingAccountId}/interactions/${interactionId}`,
      );
      setEditingInteractionId(Number(interactionId));
      setInteractionForm({
        interactionTypeId: data?.type?.id ? String(data.type.id) : "",
        resultId: data?.result?.id ? String(data.result.id) : "",
        title: data?.title || "",
        summary: data?.summary || "",
        nextStep: data?.nextStep || "",
        occurredAt: toDateTimeLocalValue(data?.occurredAt),
        followUpAt: toDateTimeLocalValue(data?.followUpAt),
        contactIds: Array.isArray(data?.contacts)
          ? data.contacts.map((contact) => Number(contact.id))
          : [],
      });
      setInteractionDocuments(
        Array.isArray(data?.documents) ? data.documents : [],
      );
      setPromotionForm(
        buildDefaultPromotionForm({
          interaction: data,
          contactOptions: accountContactOptions,
          businessLines: promotionCatalogs.businessLines,
          sellerUsers: promotionCatalogs.sellerUsers,
        }),
      );
      setShowPromotionPanel(Boolean(data?.linkedOpportunityId === null));
      setShowInteractionModal(true);
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible cargar la interaccion comercial",
        ),
      );
    }
  }

  async function saveInteraction(event) {
    event.preventDefault();
    if (!editingAccountId) return;

    setError("");
    setSuccess("");
    setSavingInteraction(true);

    try {
      const payload = {
        interactionTypeId: Number(interactionForm.interactionTypeId),
        resultId: Number(interactionForm.resultId),
        title: interactionForm.title,
        summary: interactionForm.summary,
        nextStep: interactionForm.nextStep || null,
        occurredAt: interactionForm.occurredAt,
        followUpAt: interactionForm.followUpAt || null,
        contactIds: interactionForm.contactIds.map(Number),
      };

      const { data } = editingInteractionId
        ? await api.put(
            `/api/accounts/${editingAccountId}/interactions/${editingInteractionId}`,
            payload,
          )
        : await api.post(
            `/api/accounts/${editingAccountId}/interactions`,
            payload,
          );

      await refreshAccountInteractions();
      setSuccess(
        data?.message ||
          (editingInteractionId
            ? "Interaccion comercial actualizada"
            : "Interaccion comercial registrada"),
      );

      if (data?.interaction) {
        setEditingInteractionId(Number(data.interaction.id));
        setInteractionDocuments(
          Array.isArray(data.interaction.documents)
            ? data.interaction.documents
            : [],
        );
        setPromotionForm(
          buildDefaultPromotionForm({
            interaction: data.interaction,
            contactOptions: accountContactOptions,
            businessLines: promotionCatalogs.businessLines,
            sellerUsers: promotionCatalogs.sellerUsers,
          }),
        );
      }

      if (!editingInteractionId) {
        setShowInteractionModal(false);
        closeInteractionModal();
      }
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible guardar la interaccion comercial",
        ),
      );
    } finally {
      setSavingInteraction(false);
    }
  }

  async function uploadInteractionDocuments(fileList) {
    if (!editingAccountId || !editingInteractionId) return;
    const files = Array.from(fileList || []);
    if (!files.length) return;

    setError("");
    setSuccess("");
    setUploadingInteractionDocuments(true);
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      const { data } = await api.post(
        `/api/accounts/${editingAccountId}/interactions/${editingInteractionId}/documents`,
        formData,
        {
          headers: { "Content-Type": "multipart/form-data" },
        },
      );
      setInteractionDocuments(Array.isArray(data) ? data : []);
      await refreshAccountInteractions();
      setSuccess("Documentos adjuntados a la interaccion comercial");
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible adjuntar los documentos"),
      );
    } finally {
      setUploadingInteractionDocuments(false);
    }
  }

  async function deleteInteractionDocument(documentPublicId) {
    if (!editingAccountId || !editingInteractionId || !documentPublicId) return;
    setDeletingInteractionDocumentId(documentPublicId);
    setError("");
    setSuccess("");
    try {
      const { data } = await api.delete(
        `/api/accounts/${editingAccountId}/interactions/${editingInteractionId}/documents/${documentPublicId}`,
      );
      setInteractionDocuments(Array.isArray(data) ? data : []);
      await refreshAccountInteractions();
      setSuccess("Documento eliminado de la interaccion comercial");
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible eliminar el documento"));
    } finally {
      setDeletingInteractionDocumentId("");
    }
  }

  async function downloadInteractionDocument(documentPublicId, fileName) {
    if (!editingAccountId || !editingInteractionId || !documentPublicId) return;
    setError("");
    try {
      const response = await api.get(
        `/api/accounts/${editingAccountId}/interactions/${editingInteractionId}/documents/${documentPublicId}/content`,
        { responseType: "blob" },
      );
      const objectUrl = window.URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = fileName || "documento";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible abrir el documento"));
    }
  }

  async function promoteInteractionToOpportunity() {
    if (!editingAccountId || !editingInteractionId) return;
    setError("");
    setSuccess("");
    setPromotingInteraction(true);
    try {
      const amountUsd = parseAmountInput(promotionForm.amountUsd);
      const payload = {
        name: promotionForm.name,
        amountUsd,
        closeDate: promotionForm.closeDate,
        contactId: Number(promotionForm.contactId),
        businessLineId: Number(promotionForm.businessLineId),
        sellerUserId: Number(promotionForm.sellerUserId),
        presalesUserId: promotionForm.presalesUserId
          ? Number(promotionForm.presalesUserId)
          : null,
        documentPublicIds: promotionForm.documentPublicIds,
      };
      const { data } = await api.post(
        `/api/accounts/${editingAccountId}/interactions/${editingInteractionId}/create-opportunity`,
        payload,
      );
      await refreshAccountInteractions();
      setSuccess(
        data?.message || "Oportunidad creada desde la interaccion comercial",
      );
      await openEditInteractionModal(editingInteractionId);
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible crear la oportunidad desde la interaccion comercial",
        ),
      );
    } finally {
      setPromotingInteraction(false);
    }
  }

  function toggleInteractionContact(contactId) {
    setInteractionForm((prev) => ({
      ...prev,
      contactIds: prev.contactIds.includes(Number(contactId))
        ? prev.contactIds.filter((id) => id !== Number(contactId))
        : [...prev.contactIds, Number(contactId)],
    }));
  }

  function togglePromotionDocument(documentPublicId) {
    setPromotionForm((prev) => ({
      ...prev,
      documentPublicIds: prev.documentPublicIds.includes(documentPublicId)
        ? prev.documentPublicIds.filter((id) => id !== documentPublicId)
        : [...prev.documentPublicIds, documentPublicId],
    }));
  }

  const visibleAccountInteractions = useMemo(() => {
    const query = normalizeText(interactionQuery);
    return accountInteractions.filter((interaction) => {
      if (
        interactionTypeFilter !== "all" &&
        String(interaction?.type?.code || "") !== interactionTypeFilter
      ) {
        return false;
      }
      if (
        interactionResultFilter !== "all" &&
        String(interaction?.result?.code || "") !== interactionResultFilter
      ) {
        return false;
      }
      if (!query) return true;
      const haystack = [
        interaction.title,
        interaction.summary,
        interaction.result?.name,
        interaction.type?.name,
        ...(Array.isArray(interaction.contacts)
          ? interaction.contacts.map(
              (contact) => contact.full_name || contact.fullName,
            )
          : []),
      ]
        .filter(Boolean)
        .join(" ");
      return normalizeText(haystack).includes(query);
    });
  }, [
    accountInteractions,
    interactionQuery,
    interactionResultFilter,
    interactionTypeFilter,
  ]);

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      if (!editingAccountId || !isAccountModalOpen) return;
      setLoadingAccountInteractions(true);
      try {
        await loadAccountInteractionBase(editingAccountId);
        if (cancelled) return;
      } catch (err) {
        if (!cancelled) {
          setError(
            getApiErrorMessage(
              err,
              "No fue posible cargar las interacciones comerciales",
            ),
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingAccountInteractions(false);
        }
      }
    }
    void loadData();
    return () => {
      cancelled = true;
    };
  }, [editingAccountId, isAccountModalOpen]);

  useEffect(() => {
    if (!error && !success) return undefined;
    const timeoutId = window.setTimeout(() => {
      setError("");
      setSuccess("");
    }, 4000);
    return () => window.clearTimeout(timeoutId);
  }, [error, success]);

  useEffect(() => {
    if (
      !showInteractionModal &&
      interactionTypes.length &&
      interactionResults.length
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInteractionForm(
        buildDefaultInteractionForm({ interactionTypes, interactionResults }),
      );
    }
  }, [interactionResults, interactionTypes, showInteractionModal]);

  useEffect(() => {
    if (!showInteractionModal || editingInteractionId) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInteractionForm((prev) => {
      const nextTypeId =
        prev.interactionTypeId || interactionTypes[0]?.id
          ? String(prev.interactionTypeId || interactionTypes[0]?.id || "")
          : "";
      const nextResultId =
        prev.resultId || interactionResults[0]?.id
          ? String(prev.resultId || interactionResults[0]?.id || "")
          : "";

      if (
        nextTypeId === prev.interactionTypeId &&
        nextResultId === prev.resultId
      ) {
        return prev;
      }

      return {
        ...prev,
        interactionTypeId: nextTypeId,
        resultId: nextResultId,
      };
    });
  }, [
    editingInteractionId,
    interactionResults,
    interactionTypes,
    showInteractionModal,
  ]);

  return {
    interactionTypes,
    interactionResults,
    accountContactOptions,
    promotionCatalogs,
    accountInteractions,
    visibleAccountInteractions,
    loadingAccountInteractions,
    showInteractionModal,
    editingInteractionId,
    interactionForm,
    setInteractionForm,
    interactionDocuments,
    savingInteraction,
    uploadingInteractionDocuments,
    deletingInteractionDocumentId,
    interactionTypeFilter,
    setInteractionTypeFilter,
    interactionResultFilter,
    setInteractionResultFilter,
    interactionQuery,
    setInteractionQuery,
    showPromotionPanel,
    setShowPromotionPanel,
    promotionForm,
    setPromotionForm,
    promotingInteraction,
    error,
    success,
    openCreateInteractionModal,
    openEditInteractionModal,
    closeInteractionModal,
    saveInteraction,
    uploadInteractionDocuments,
    deleteInteractionDocument,
    downloadInteractionDocument,
    promoteInteractionToOpportunity,
    toggleInteractionContact,
    togglePromotionDocument,
    formatAmountInput,
  };
}
