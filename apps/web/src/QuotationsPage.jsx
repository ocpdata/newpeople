import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import ProposalTemplatePickerModal from "./ProposalTemplatePickerModal";
import QuotationsSection from "./quotations/QuotationsSection";
import { api, getApiErrorMessage } from "./api";
import "./quotations/quotations.css";

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function mapContactOption(contact) {
  return {
    id: Number(contact.id),
    account_id: Number(contact.accountId ?? contact.account_id),
    full_name: contact.fullName || contact.full_name || "",
    email: contact.email || "",
    phone: contact.phone || "",
  };
}

function normalizeProposalTemplateOption(template) {
  return {
    id: Number(template.id),
    code: template.code || "",
    name: template.name || "",
    description: template.description || "",
    previewTitle: template.previewTitle || template.preview_title || "",
    coverStyle: template.coverStyle || template.cover_style || "corporate",
    isDefault: Boolean(template.isDefault ?? template.is_default),
  };
}

export default function QuotationsPage({ currentUser }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const quotationsSectionRef = useRef(null);
  const [initialSelectedOpportunityId] = useState(
    searchParams.get("opportunityId") || "",
  );
  const [accounts, setAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [opportunities, setOpportunities] = useState([]);
  const [selectedOpportunityId, setSelectedOpportunityId] = useState(
    initialSelectedOpportunityId,
  );
  const [contactOptions, setContactOptions] = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingOpportunities, setLoadingOpportunities] = useState(true);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [error, setError] = useState("");
  const [proposalTemplates, setProposalTemplates] = useState([]);
  const [loadingProposalTemplates, setLoadingProposalTemplates] =
    useState(false);
  const [proposalTemplateModal, setProposalTemplateModal] = useState({
    isOpen: false,
    versionId: null,
  });
  const [selectedProposalTemplateId, setSelectedProposalTemplateId] =
    useState(null);

  const selectedAccount = useMemo(
    () =>
      accounts.find(
        (account) => Number(account.id) === Number(selectedAccountId),
      ) || null,
    [accounts, selectedAccountId],
  );

  const selectedOpportunity = useMemo(
    () =>
      opportunities.find(
        (opportunity) =>
          Number(opportunity.id) === Number(selectedOpportunityId),
      ) || null,
    [opportunities, selectedOpportunityId],
  );

  const defaultProposalTemplateId = useMemo(
    () =>
      proposalTemplates.find((template) => template.isDefault)?.id ||
      proposalTemplates[0]?.id ||
      null,
    [proposalTemplates],
  );

  const loadProposalTemplates = useCallback(async () => {
    setLoadingProposalTemplates(true);
    try {
      const { data } = await api.get("/api/proposal-templates");
      const nextTemplates = Array.isArray(data)
        ? data.map(normalizeProposalTemplateOption)
        : [];
      setProposalTemplates(nextTemplates);
      return nextTemplates;
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible cargar las plantillas disponibles para propuestas",
        ),
      );
      return [];
    } finally {
      setLoadingProposalTemplates(false);
    }
  }, []);

  const closeProposalTemplateModal = useCallback(() => {
    setProposalTemplateModal({ isOpen: false, versionId: null });
  }, []);

  const openProposalTemplateModal = useCallback(
    async (versionId) => {
      const nextVersionId = Number(versionId || 0) || null;
      if (!nextVersionId) return;
      setProposalTemplateModal({ isOpen: true, versionId: nextVersionId });
      const templates = proposalTemplates.length
        ? proposalTemplates
        : await loadProposalTemplates();
      const nextDefaultId =
        templates.find((template) => template.isDefault)?.id ||
        templates[0]?.id ||
        null;
      setSelectedProposalTemplateId(nextDefaultId);
    },
    [loadProposalTemplates, proposalTemplates],
  );

  const handleConfirmProposalTemplate = useCallback(() => {
    const versionId = Number(proposalTemplateModal.versionId || 0) || null;
    if (!versionId) return;
    const params = new URLSearchParams({
      createFromVersionId: String(versionId),
    });
    const templateId =
      Number(selectedProposalTemplateId || 0) || defaultProposalTemplateId;
    if (templateId) {
      params.set("templateId", String(templateId));
    }
    closeProposalTemplateModal();
    navigate(`/proposals?${params.toString()}`);
  }, [
    closeProposalTemplateModal,
    defaultProposalTemplateId,
    navigate,
    proposalTemplateModal.versionId,
    selectedProposalTemplateId,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function loadAccounts() {
      setLoadingAccounts(true);
      setError("");
      try {
        const requests = [api.get("/api/quotation-accounts")];
        if (initialSelectedOpportunityId) {
          requests.push(api.get("/api/quotation-opportunities"));
        }

        const [accountsResponse, opportunitiesResponse] =
          await Promise.all(requests);
        if (cancelled) return;

        const nextAccounts = Array.isArray(accountsResponse.data)
          ? accountsResponse.data.map((account) => ({
              id: Number(account.id),
              name: account.name,
            }))
          : [];
        setAccounts(nextAccounts);

        const requestedOpportunityId = Number(initialSelectedOpportunityId);
        const allOpportunities = Array.isArray(opportunitiesResponse?.data)
          ? opportunitiesResponse.data
          : [];
        const requestedOpportunity = allOpportunities.find(
          (opportunity) => Number(opportunity.id) === requestedOpportunityId,
        );
        const preservedAccount = nextAccounts.find(
          (account) => Number(account.id) === Number(selectedAccountId),
        );
        const nextSelectedAccount =
          nextAccounts.find(
            (account) =>
              Number(account.id) === Number(requestedOpportunity?.accountId),
          ) ||
          preservedAccount ||
          nextAccounts[0] ||
          null;

        const nextSelectedAccountId = nextSelectedAccount
          ? String(nextSelectedAccount.id)
          : "";
        setSelectedAccountId(nextSelectedAccountId);

        if (!nextSelectedAccountId) {
          setSelectedOpportunityId("");
          setContactOptions([]);
          setOpportunities([]);
          setSearchParams({}, { replace: true });
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            getApiErrorMessage(
              err,
              "No fue posible cargar las cuentas disponibles para cotizaciones",
            ),
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingAccounts(false);
        }
      }
    }

    loadAccounts();

    return () => {
      cancelled = true;
    };
  }, [initialSelectedOpportunityId, selectedAccountId, setSearchParams]);

  useEffect(() => {
    if (!selectedAccountId) return;

    let cancelled = false;

    async function loadAccountContext() {
      setLoadingOpportunities(true);
      setLoadingContacts(true);
      setError("");
      try {
        const [opportunitiesResponse, contactsResponse] = await Promise.all([
          api.get(`/api/quotation-accounts/${selectedAccountId}/opportunities`),
          api.get(`/api/quotation-accounts/${selectedAccountId}/contacts`),
        ]);
        if (cancelled) return;

        const nextOpportunities = Array.isArray(opportunitiesResponse.data)
          ? opportunitiesResponse.data.map((opportunity) => ({
              ...opportunity,
              id: Number(opportunity.id),
              accountId: Number(opportunity.accountId),
              contactId: Number(opportunity.contactId),
              amountUsd:
                opportunity.amountUsd ?? opportunity.amount_usd ?? null,
              closeDate: opportunity.closeDate || opportunity.close_date || "",
              salesStageName:
                opportunity.salesStageName || opportunity.sales_stage || "",
              sellerUserId: opportunity.sellerUserId
                ? Number(opportunity.sellerUserId)
                : null,
            }))
          : [];
        const nextContacts = Array.isArray(contactsResponse.data)
          ? contactsResponse.data.map(mapContactOption)
          : [];

        setOpportunities(nextOpportunities);
        setContactOptions(nextContacts);

        const requestedOpportunityId = Number(initialSelectedOpportunityId);
        const requestedOpportunity = nextOpportunities.find(
          (opportunity) => Number(opportunity.id) === requestedOpportunityId,
        );
        const currentOpportunity = nextOpportunities.find(
          (opportunity) =>
            Number(opportunity.id) === Number(selectedOpportunityId),
        );
        const nextSelectedOpportunity =
          requestedOpportunity ||
          currentOpportunity ||
          nextOpportunities.find(
            (opportunity) =>
              normalizeText(opportunity.activationStatusName) === "activada",
          ) ||
          nextOpportunities[0] ||
          null;

        const nextSelectedOpportunityId = nextSelectedOpportunity
          ? String(nextSelectedOpportunity.id)
          : "";

        setSelectedOpportunityId(nextSelectedOpportunityId);
        if (nextSelectedOpportunityId) {
          setSearchParams(
            { opportunityId: nextSelectedOpportunityId },
            { replace: true },
          );
        } else {
          setSearchParams({}, { replace: true });
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            getApiErrorMessage(
              err,
              "No fue posible cargar el contexto comercial de cotizaciones",
            ),
          );
          setOpportunities([]);
          setContactOptions([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingOpportunities(false);
          setLoadingContacts(false);
        }
      }
    }

    loadAccountContext();

    return () => {
      cancelled = true;
    };
  }, [
    initialSelectedOpportunityId,
    selectedAccountId,
    selectedOpportunityId,
    setSearchParams,
  ]);

  useEffect(() => {
    if (!error) return undefined;
    const timeoutId = window.setTimeout(() => setError(""), 10000);
    return () => window.clearTimeout(timeoutId);
  }, [error]);

  const hasAvailableAccounts = accounts.length > 0;
  const quotationPermissions = useMemo(
    () => new Set(currentUser?.permissions || []),
    [currentUser],
  );
  const canCreateQuotation =
    quotationPermissions.has("cotizaciones.operacion") ||
    quotationPermissions.has("cotizaciones.administracion");
  const canOpenCreateQuotationModal =
    canCreateQuotation && hasAvailableAccounts && !loadingAccounts;
  const handleQuotationOpportunityFocusChange = useCallback(
    (nextOpportunityId) => {
      const normalizedOpportunityId = String(nextOpportunityId || "");
      setSelectedOpportunityId(normalizedOpportunityId);
      if (normalizedOpportunityId) {
        setSearchParams(
          { opportunityId: normalizedOpportunityId },
          { replace: true },
        );
        return;
      }

      setSearchParams({}, { replace: true });
    },
    [setSearchParams],
  );

  return (
    <section className="panel">
      <div className="roles-page-header">
        <div className="roles-page-header-left">
          <div className="module-title-with-icon">
            <h2>Cotizaciones</h2>
            <span
              className="module-title-icon module-title-icon-quotations"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M7 4.75A2.25 2.25 0 0 0 4.75 7v10A2.25 2.25 0 0 0 7 19.25h10A2.25 2.25 0 0 0 19.25 17V9.81a.75.75 0 0 0-.22-.53l-4.31-4.31a.75.75 0 0 0-.53-.22zm0 1.5h6.19l4.56 4.56V17a.75.75 0 0 1-.75.75H7a.75.75 0 0 1-.75-.75V7A.75.75 0 0 1 7 6.25" />
                <path d="M13.25 5.5a.75.75 0 0 1 1.5 0v3.25h3.25a.75.75 0 0 1 0 1.5H14a.75.75 0 0 1-.75-.75z" />
                <path d="M8.5 12.25a.75.75 0 0 1 .75-.75h5.5a.75.75 0 0 1 0 1.5h-5.5a.75.75 0 0 1-.75-.75m0 3a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1-.75-.75" />
              </svg>
            </span>
          </div>
          <p className="roles-subtitle">
            Gestiona las cotizaciones por oportunidad desde un modulo
            independiente
          </p>
          <p className="field-hint">
            Consulta el listado disponible y crea nuevas cotizaciones desde la
            accion principal del modulo.
          </p>
        </div>
        {canCreateQuotation ? (
          <button
            type="button"
            className="btn-primary"
            disabled={!canOpenCreateQuotationModal}
            onClick={() =>
              quotationsSectionRef.current?.openCreateQuotationModal()
            }
          >
            + Crear cotizacion
          </button>
        ) : null}
      </div>

      {!loadingAccounts && !hasAvailableAccounts ? (
        <p className="field-hint quotation-page-feedback">
          No hay cuentas disponibles para administrar cotizaciones.
        </p>
      ) : null}

      {!loadingAccounts &&
      hasAvailableAccounts &&
      !loadingOpportunities &&
      !opportunities.length ? (
        <p className="field-hint quotation-page-feedback">
          La cuenta seleccionada no tiene oportunidades disponibles para
          cotizaciones.
        </p>
      ) : null}

      {loadingContacts && selectedOpportunity ? (
        <p className="field-hint quotation-page-feedback">
          Cargando contactos de la cuenta seleccionada...
        </p>
      ) : null}

      {selectedOpportunity && !selectedOpportunity.sellerUserId ? (
        <p className="field-hint quotation-page-feedback quotation-page-warning">
          La oportunidad seleccionada no tiene vendedor asignado. No se puede
          crear una cotizacion hasta corregirlo.
        </p>
      ) : null}

      {selectedOpportunity &&
      !loadingContacts &&
      contactOptions.length === 0 ? (
        <p className="field-hint quotation-page-feedback quotation-page-warning">
          La cuenta seleccionada no tiene contactos disponibles para crear
          cotizaciones.
        </p>
      ) : null}

      {hasAvailableAccounts ? (
        <QuotationsSection
          ref={quotationsSectionRef}
          accounts={accounts}
          accountId={selectedAccount?.id || null}
          accountName={selectedAccount?.name || ""}
          loadingAccounts={loadingAccounts}
          opportunities={opportunities}
          opportunityId={selectedOpportunity?.id || null}
          opportunityName={selectedOpportunity?.name || ""}
          opportunityActivationStatus={
            selectedOpportunity?.activationStatusName || ""
          }
          sellerUserId={selectedOpportunity?.sellerUserId || null}
          sellerUserName={selectedOpportunity?.sellerUserName || ""}
          contactOptions={contactOptions}
          currentUser={currentUser}
          onOpportunityFocusChange={handleQuotationOpportunityFocusChange}
          onCreateProposalFromQuotationVersion={(_quotation, version) => {
            const versionId = Number(version?.id || 0) || null;
            const proposalId = Number(version?.proposalId || 0) || null;
            if (proposalId) {
              navigate(`/proposals?proposalId=${proposalId}`);
              return;
            }
            openProposalTemplateModal(versionId);
          }}
          isOpen
          showHeader={false}
          showCreateButton={false}
          showDetails={false}
        />
      ) : null}

      <ProposalTemplatePickerModal
        isOpen={proposalTemplateModal.isOpen}
        title="Elegir plantilla"
        subtitle="La plantilla define portada, ritmo visual y narrativa base. El pricing sigue heredandose de la cotizacion aprobada."
        templates={proposalTemplates}
        loading={loadingProposalTemplates}
        selectedTemplateId={selectedProposalTemplateId}
        onSelectTemplate={setSelectedProposalTemplateId}
        onClose={closeProposalTemplateModal}
        onConfirm={handleConfirmProposalTemplate}
        confirmLabel="Crear propuesta"
      />

      {error ? <div className="toast toast-error">{error}</div> : null}
    </section>
  );
}
