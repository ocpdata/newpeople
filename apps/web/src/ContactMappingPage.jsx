import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import ContactFormModal from "./contacts/ContactFormModal";
import { useContactsPage } from "./contacts/useContactsPage";

const ORG_NODE_WIDTH = 220;
const ORG_NODE_HEIGHT = 118;
const ORG_HORIZONTAL_GAP = 28;
const ORG_ROOT_GAP = 72;
const ORG_VERTICAL_GAP = 102;
const ORG_CANVAS_PADDING_X = 28;
const ORG_CANVAS_PADDING_Y = 24;
const ORG_CONNECTOR_DROP = 34;

const DECISION_POWER_ORDER = {
  "Puede vetar": 0,
  "Decide final": 1,
  "Decide parcialmente": 2,
  Recomienda: 3,
  Ninguno: 4,
};

const HIERARCHY_LEVEL_ORDER = {
  Director: 0,
  Gerente: 1,
  Líder: 2,
  Especialista: 3,
  Usuario: 4,
  Otro: 5,
};

function getDecisionPowerRank(contact) {
  return DECISION_POWER_ORDER[contact.purchase_participation] ?? 99;
}

function getHierarchyLevelRank(contact) {
  return HIERARCHY_LEVEL_ORDER[contact.hierarchy_level] ?? 99;
}

function sortContacts(left, right) {
  const decisionDelta =
    getDecisionPowerRank(left) - getDecisionPowerRank(right);
  if (decisionDelta !== 0) return decisionDelta;

  const hierarchyDelta =
    getHierarchyLevelRank(left) - getHierarchyLevelRank(right);
  if (hierarchyDelta !== 0) return hierarchyDelta;

  return String(left.full_name || "").localeCompare(
    String(right.full_name || ""),
    "es",
    {
      sensitivity: "base",
    },
  );
}

function buildContactTree(contacts) {
  const sortedContacts = [...contacts].sort(sortContacts);
  const contactsById = new Map(
    sortedContacts.map((contact) => [Number(contact.id), contact]),
  );
  const childrenByParentId = new Map();

  sortedContacts.forEach((contact) => {
    const parentId = Number(contact.manager_contact_id || 0);
    if (
      !parentId ||
      !contactsById.has(parentId) ||
      parentId === Number(contact.id)
    ) {
      return;
    }

    const siblings = childrenByParentId.get(parentId) || [];
    siblings.push(contact);
    siblings.sort(sortContacts);
    childrenByParentId.set(parentId, siblings);
  });

  const roots = sortedContacts.filter((contact) => {
    const parentId = Number(contact.manager_contact_id || 0);
    return (
      !parentId ||
      !contactsById.has(parentId) ||
      parentId === Number(contact.id)
    );
  });

  const visited = new Set();

  function visit(nodeId, branchVisited = new Set()) {
    if (branchVisited.has(nodeId)) return;
    branchVisited.add(nodeId);
    visited.add(nodeId);
    const children = childrenByParentId.get(nodeId) || [];
    children.forEach((child) =>
      visit(Number(child.id), new Set(branchVisited)),
    );
  }

  roots.forEach((root) => visit(Number(root.id)));

  const residualRoots = sortedContacts.filter(
    (contact) => !visited.has(Number(contact.id)),
  );

  return {
    roots,
    residualRoots,
    childrenByParentId,
    contactsById,
  };
}

function getNodeDepth(
  nodeId,
  contactsById,
  memo = new Map(),
  stack = new Set(),
) {
  if (memo.has(nodeId)) return memo.get(nodeId);
  if (stack.has(nodeId)) return 0;

  stack.add(nodeId);
  const node = contactsById.get(nodeId);
  if (!node) {
    memo.set(nodeId, 0);
    stack.delete(nodeId);
    return 0;
  }

  const parentId = Number(node.manager_contact_id || 0);
  const hasParent =
    parentId && contactsById.has(parentId) && parentId !== nodeId;
  const depth = hasParent
    ? getNodeDepth(parentId, contactsById, memo, stack) + 1
    : 0;

  memo.set(nodeId, depth);
  stack.delete(nodeId);
  return depth;
}

function buildOrgChartLayout(contactTree) {
  const rootIds = [
    ...contactTree.roots.map((contact) => Number(contact.id)),
    ...contactTree.residualRoots.map((contact) => Number(contact.id)),
  ].filter((value, index, list) => list.indexOf(value) === index);

  const subtreeWidths = new Map();
  const positionedNodes = [];
  const depthMemo = new Map();
  const depthById = new Map();
  const connectorPaths = [];
  let maxDepth = 0;

  function measureSubtree(nodeId, lineage = new Set()) {
    if (subtreeWidths.has(nodeId)) return subtreeWidths.get(nodeId);
    if (lineage.has(nodeId)) return ORG_NODE_WIDTH;

    const nextLineage = new Set(lineage);
    nextLineage.add(nodeId);
    const childIds = (contactTree.childrenByParentId.get(nodeId) || []).map(
      (child) => Number(child.id),
    );
    if (!childIds.length) {
      subtreeWidths.set(nodeId, ORG_NODE_WIDTH);
      return ORG_NODE_WIDTH;
    }

    const childrenWidth = childIds.reduce((sum, childId, index) => {
      const childWidth = measureSubtree(childId, nextLineage);
      return sum + childWidth + (index > 0 ? ORG_HORIZONTAL_GAP : 0);
    }, 0);

    const subtreeWidth = Math.max(ORG_NODE_WIDTH, childrenWidth);
    subtreeWidths.set(nodeId, subtreeWidth);
    return subtreeWidth;
  }

  function placeSubtree(nodeId, left, lineage = new Set()) {
    if (lineage.has(nodeId)) return;
    const nextLineage = new Set(lineage);
    nextLineage.add(nodeId);

    const node = contactTree.contactsById.get(nodeId);
    if (!node) return;

    const subtreeWidth = subtreeWidths.get(nodeId) || ORG_NODE_WIDTH;
    const depth = getNodeDepth(nodeId, contactTree.contactsById, depthMemo);
    depthById.set(nodeId, depth);
    maxDepth = Math.max(maxDepth, depth);
    const x = left + (subtreeWidth - ORG_NODE_WIDTH) / 2;
    const y = depth * (ORG_NODE_HEIGHT + ORG_VERTICAL_GAP);

    positionedNodes.push({
      id: nodeId,
      contact: node,
      x,
      y,
      width: ORG_NODE_WIDTH,
      height: ORG_NODE_HEIGHT,
      depth,
      childIds: (contactTree.childrenByParentId.get(nodeId) || []).map(
        (child) => Number(child.id),
      ),
    });

    const childIds = (contactTree.childrenByParentId.get(nodeId) || []).map(
      (child) => Number(child.id),
    );
    if (!childIds.length) return;

    let currentLeft = left;
    childIds.forEach((childId) => {
      const childWidth = subtreeWidths.get(childId) || ORG_NODE_WIDTH;
      placeSubtree(childId, currentLeft, nextLineage);
      currentLeft += childWidth + ORG_HORIZONTAL_GAP;
    });
  }

  rootIds.forEach((rootId) => measureSubtree(rootId));

  let currentLeft = ORG_CANVAS_PADDING_X;
  rootIds.forEach((rootId, index) => {
    placeSubtree(rootId, currentLeft);
    currentLeft +=
      (subtreeWidths.get(rootId) || ORG_NODE_WIDTH) +
      (index < rootIds.length - 1 ? ORG_ROOT_GAP : 0);
  });

  const positionedNodesById = new Map(
    positionedNodes.map((node) => [node.id, node]),
  );

  positionedNodes.forEach((node) => {
    if (!node.childIds.length) return;

    const parentCenterX = node.x + node.width / 2;
    const parentBottomY = node.y + node.height;
    const busY = parentBottomY + ORG_CONNECTOR_DROP;
    const childCenters = node.childIds
      .map((childId) => positionedNodesById.get(childId))
      .filter(Boolean)
      .map((childNode) => childNode.x + childNode.width / 2);

    if (!childCenters.length) return;

    connectorPaths.push({
      id: `connector-parent-${node.id}`,
      d: `M ${parentCenterX} ${parentBottomY} V ${busY}`,
      kind: "hierarchy",
    });

    if (childCenters.length > 1) {
      connectorPaths.push({
        id: `connector-bus-${node.id}`,
        d: `M ${Math.min(...childCenters)} ${busY} H ${Math.max(...childCenters)}`,
        kind: "hierarchy",
      });
    }

    node.childIds.forEach((childId) => {
      const childNode = positionedNodesById.get(childId);
      if (!childNode) return;
      connectorPaths.push({
        id: `connector-child-${node.id}-${childId}`,
        d: `M ${childNode.x + childNode.width / 2} ${busY} V ${childNode.y}`,
        kind: "hierarchy",
      });
    });
  });

  const canvasWidth = Math.max(
    currentLeft - ORG_ROOT_GAP + ORG_CANVAS_PADDING_X,
    ORG_NODE_WIDTH + ORG_CANVAS_PADDING_X * 2,
  );
  const canvasHeight =
    (maxDepth + 1) * ORG_NODE_HEIGHT +
    maxDepth * ORG_VERTICAL_GAP +
    ORG_CANVAS_PADDING_Y * 2;

  return {
    rootIds,
    positionedNodes,
    positionedNodesById,
    connectorPaths,
    depthById,
    canvasWidth,
    canvasHeight,
  };
}

function buildInfluenceConnector(layout, sourceContactId, targetContactId) {
  if (!sourceContactId || !targetContactId) return null;
  const sourceNode = layout.positionedNodesById.get(Number(sourceContactId));
  const targetNode = layout.positionedNodesById.get(Number(targetContactId));
  if (!sourceNode || !targetNode) return null;

  const sourceIsLeft = sourceNode.x <= targetNode.x;
  const fromX = sourceIsLeft ? sourceNode.x + sourceNode.width : sourceNode.x;
  const toX = sourceIsLeft ? targetNode.x : targetNode.x + targetNode.width;
  const fromY = sourceNode.y + sourceNode.height / 2;
  const toY = targetNode.y + targetNode.height / 2;
  const curve = Math.max(68, Math.abs(toX - fromX) * 0.36);

  return `M ${fromX} ${fromY} C ${fromX + (sourceIsLeft ? curve : -curve)} ${fromY}, ${toX + (sourceIsLeft ? -curve : curve)} ${toY}, ${toX} ${toY}`;
}

function getInfluenceStrokeTone(influenceLevel) {
  const value = String(influenceLevel || "").toLowerCase();
  if (value.includes("alta")) return "high";
  if (value.includes("media")) return "medium";
  return "low";
}

function buildInfluenceOverlay({
  layout,
  selectedContact,
  incomingInfluencers,
}) {
  if (!selectedContact) {
    return {
      paths: [],
      relatedIds: new Set(),
    };
  }

  const selectedId = Number(selectedContact.id);
  const relatedIds = new Set([selectedId]);
  const paths = [];

  const outgoingTargetId = Number(selectedContact.influences_contact_id || 0);
  if (outgoingTargetId) {
    const path = buildInfluenceConnector(layout, selectedId, outgoingTargetId);
    if (path) {
      relatedIds.add(outgoingTargetId);
      paths.push({
        id: `influence-outgoing-${selectedId}-${outgoingTargetId}`,
        d: path,
        direction: "outgoing",
        tone: getInfluenceStrokeTone(selectedContact.influence_level),
      });
    }
  }

  incomingInfluencers.forEach((contact) => {
    const sourceId = Number(contact.id);
    const path = buildInfluenceConnector(layout, sourceId, selectedId);
    if (!path) return;
    relatedIds.add(sourceId);
    paths.push({
      id: `influence-incoming-${sourceId}-${selectedId}`,
      d: path,
      direction: "incoming",
      tone: getInfluenceStrokeTone(contact.influence_level),
    });
  });

  return {
    paths,
    relatedIds,
  };
}

function getBadgeTone(label, kind) {
  const value = String(label || "").toLowerCase();
  if (kind === "decision") {
    if (value.includes("vetar") || value.includes("final")) return "critical";
    if (value.includes("parcial")) return "strong";
    if (value.includes("recomienda")) return "medium";
    return "muted";
  }
  if (kind === "influence") {
    if (value.includes("alta")) return "strong";
    if (value.includes("media")) return "medium";
    return "muted";
  }
  if (kind === "relationship") {
    if (value.includes("fuerte")) return "strong";
    if (value.includes("media")) return "medium";
    return "muted";
  }
  if (kind === "hierarchy") {
    if (value.includes("director") || value.includes("gerente"))
      return "strong";
    if (value.includes("lider")) return "medium";
    return "muted";
  }
  return "muted";
}

function ContactOrgNode({
  node,
  selectedContactId,
  highlightedInfluenceTargetId,
  incomingInfluencerIds,
  shouldMute,
  onSelect,
  getContactStatusBadgeClass,
}) {
  const { contact, x, y, width, height } = node;
  const contactId = Number(contact.id);
  const isSelected = contactId === Number(selectedContactId || 0);
  const isInfluenceTarget =
    contactId === Number(highlightedInfluenceTargetId || 0);
  const isIncomingInfluencer = incomingInfluencerIds.has(contactId);

  const initials = String(contact.full_name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

  return (
    <button
      type="button"
      className={`contact-org-node${isSelected ? " is-selected" : ""}${isInfluenceTarget ? " is-influence-target" : ""}${isIncomingInfluencer ? " is-incoming-influencer" : ""}${shouldMute ? " is-muted" : ""}`}
      style={{ left: x, top: y, width, minHeight: height }}
      onClick={() => onSelect(contactId)}
    >
      <div className="contact-org-node-header">
        <span className="contact-org-node-avatar" aria-hidden="true">
          {initials || "?"}
        </span>
        <span className={getContactStatusBadgeClass(contact)}>
          {contact.activation_status || "-"}
        </span>
      </div>
      <strong className="contact-org-node-name">{contact.full_name}</strong>
      <p className="contact-org-node-role">
        {contact.position_title || "Sin cargo registrado"}
      </p>
      <div className="contact-org-node-footer">
        <span
          className={`contact-org-node-chip tone-${getBadgeTone(contact.purchase_participation, "decision")}`}
        >
          {contact.purchase_participation || "Sin poder"}
        </span>
        <span
          className={`contact-org-node-chip tone-${getBadgeTone(contact.relationship_type, "relationship")}`}
        >
          {contact.relationship_type || "Sin relación"}
        </span>
      </div>
      {isInfluenceTarget ? (
        <span className="contact-map-influence-flag">
          Objetivo de influencia
        </span>
      ) : null}
      {isIncomingInfluencer ? (
        <span className="contact-map-influence-flag is-incoming">
          Influye sobre seleccionado
        </span>
      ) : null}
    </button>
  );
}

export default function ContactMappingPage({ currentUser }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const helpRef = useRef(null);
  const {
    contacts,
    showContactModal,
    editingContactId,
    editContactAudit,
    contactDuplicateReview,
    savingContact,
    error,
    success,
    catalogs,
    form,
    managerOptions,
    editingContact,
    getContactStatusBadgeClass,
    getContactStatusIconBadgeClass,
    getContactStatusLabel,
    formatDateTime,
    updateContactFormField,
    normalizeContactFormField,
    handleContactAccountChange,
    openCreateContactModal,
    openEditContactModal,
    closeContactModal,
    saveContact,
    dismissContactDuplicateReview,
    openDuplicateCandidateContact,
  } = useContactsPage({ currentUser, searchParams, setSearchParams });

  const selectedAccountId = searchParams.get("accountId") || "";
  const selectedContactId = searchParams.get("contactId") || "";
  const rawViewMode = searchParams.get("view") || "mixed";
  const viewMode = ["hierarchy", "mixed", "influence"].includes(rawViewMode)
    ? rawViewMode
    : "mixed";

  const accountOptions = useMemo(
    () =>
      [...(catalogs.accounts || [])].sort((left, right) =>
        String(left.name || "").localeCompare(String(right.name || ""), "es", {
          sensitivity: "base",
        }),
      ),
    [catalogs.accounts],
  );

  const selectedAccount = useMemo(
    () =>
      accountOptions.find(
        (account) => String(account.id) === String(selectedAccountId),
      ) || null,
    [accountOptions, selectedAccountId],
  );

  const accountContacts = useMemo(() => {
    if (!selectedAccountId) return [];
    return contacts
      .filter(
        (contact) => String(contact.account_id) === String(selectedAccountId),
      )
      .sort(sortContacts);
  }, [contacts, selectedAccountId]);

  const contactTree = useMemo(
    () => buildContactTree(accountContacts),
    [accountContacts],
  );

  const orgChartLayout = useMemo(
    () => buildOrgChartLayout(contactTree),
    [contactTree],
  );

  const selectedContact = useMemo(
    () =>
      accountContacts.find(
        (contact) => String(contact.id) === String(selectedContactId),
      ) || null,
    [accountContacts, selectedContactId],
  );

  const highlightedInfluenceTargetId = selectedContact?.influences_contact_id
    ? Number(selectedContact.influences_contact_id)
    : null;

  const incomingInfluencers = useMemo(
    () =>
      selectedContact
        ? accountContacts.filter(
            (contact) =>
              Number(contact.influences_contact_id || 0) ===
              Number(selectedContact.id),
          )
        : [],
    [accountContacts, selectedContact],
  );

  const influenceOverlay = useMemo(
    () =>
      buildInfluenceOverlay({
        layout: orgChartLayout,
        selectedContact,
        incomingInfluencers,
      }),
    [orgChartLayout, selectedContact, incomingInfluencers],
  );

  const incomingInfluencerIds = useMemo(
    () => new Set(incomingInfluencers.map((contact) => Number(contact.id))),
    [incomingInfluencers],
  );

  const contactsWithoutManager = useMemo(
    () =>
      accountContacts.filter((contact) => {
        const managerId = Number(contact.manager_contact_id || 0);
        return (
          !managerId ||
          !contactTree.contactsById.has(managerId) ||
          managerId === Number(contact.id)
        );
      }).length,
    [accountContacts, contactTree.contactsById],
  );

  const metrics = useMemo(
    () => ({
      total: accountContacts.length,
      keyDecisionMakers: accountContacts.filter((contact) => {
        const power = String(contact.purchase_participation || "");
        return power === "Decide final" || power === "Puede vetar";
      }).length,
      highInfluence: accountContacts.filter(
        (contact) => String(contact.influence_level || "") === "Alta",
      ).length,
      withoutManager: contactsWithoutManager,
    }),
    [accountContacts, contactsWithoutManager],
  );

  useEffect(() => {
    if (!helpRef.current?.open) return undefined;

    function handlePointerDown(event) {
      if (!helpRef.current?.contains(event.target)) {
        helpRef.current.removeAttribute("open");
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape" && helpRef.current?.open) {
        helpRef.current.removeAttribute("open");
        helpRef.current.querySelector("summary")?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [helpRef, selectedAccountId]);

  useEffect(() => {
    if (!selectedAccountId) return;
    if (selectedContact) return;

    if (accountContacts.length === 0) {
      const next = new URLSearchParams(searchParams);
      next.delete("contactId");
      setSearchParams(next, { replace: true });
      return;
    }

    const firstContactId = String(
      orgChartLayout.positionedNodes[0]?.id || accountContacts[0]?.id || "",
    );
    if (!firstContactId) return;
    const next = new URLSearchParams(searchParams);
    next.set("contactId", firstContactId);
    setSearchParams(next, { replace: true });
  }, [
    selectedAccountId,
    selectedContact,
    accountContacts,
    orgChartLayout.positionedNodes,
    searchParams,
    setSearchParams,
  ]);

  function updateMappingSearchParam(key, value) {
    const next = new URLSearchParams(searchParams);
    if (value) {
      next.set(key, String(value));
    } else {
      next.delete(key);
    }
    setSearchParams(next, { replace: true });
  }

  function handleViewModeChange(nextMode) {
    updateMappingSearchParam("view", nextMode);
  }

  function handleAccountSelect(event) {
    const nextAccountId = String(event.target.value || "");
    const next = new URLSearchParams(searchParams);
    if (nextAccountId) {
      next.set("accountId", nextAccountId);
    } else {
      next.delete("accountId");
    }
    next.delete("contactId");
    setSearchParams(next, { replace: true });
  }

  function handleCreateContactForAccount() {
    if (!selectedAccountId) return;
    openCreateContactModal();
    handleContactAccountChange(selectedAccountId);
  }

  const hasHierarchy = accountContacts.some((contact) => {
    const managerId = Number(contact.manager_contact_id || 0);
    return (
      managerId &&
      contactTree.contactsById.has(managerId) &&
      managerId !== Number(contact.id)
    );
  });

  return (
    <section className="panel contact-mapping-page">
      <div className="roles-page-header contact-mapping-header">
        <div className="roles-page-header-left">
          <div className="module-title-with-icon">
            <h2>Mapeo de contactos</h2>
            <span
              className="module-title-icon module-title-icon-contacts"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M8 4.75a2.75 2.75 0 1 0 0 5.5 2.75 2.75 0 0 0 0-5.5m8 0a2.75 2.75 0 1 0 0 5.5 2.75 2.75 0 0 0 0-5.5M12 13a3 3 0 1 0 0 6 3 3 0 0 0 0-6M6.75 10.75h2v2.3h-2zm8.5 0h2v2.3h-2zM11 9h2v4h-2z" />
              </svg>
            </span>
            <details className="accounts-module-help" ref={helpRef}>
              <summary
                className="accounts-module-help-trigger"
                aria-label="Ayuda sobre el módulo de mapeo de contactos"
                title="Ayuda sobre el módulo"
              >
                ?
              </summary>
              <div className="accounts-module-help-popover">
                <strong>Para qué sirve</strong>
                <p>
                  Esta vista organiza los contactos de una cuenta por jerarquía
                  formal y te deja ver la influencia comercial solo cuando la
                  necesitas.
                </p>
                <strong>Cómo leerla</strong>
                <p>
                  El árbol se construye desde el campo Jefe. Selecciona una
                  persona para ver su contexto, a quién influye y quién depende
                  de ella.
                </p>
              </div>
            </details>
          </div>
          <p className="roles-subtitle">
            Visualiza la estructura de una cuenta y detecta decisores, reportes
            y relaciones de influencia.
          </p>
        </div>

        <div className="contact-mapping-account-picker">
          <label htmlFor="contact-map-account">Cuenta</label>
          <select
            id="contact-map-account"
            value={selectedAccountId}
            onChange={handleAccountSelect}
          >
            <option value="">Selecciona una cuenta</option>
            {accountOptions.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {showContactModal ? (
        <ContactFormModal
          isOpen={showContactModal}
          editingContactId={editingContactId}
          currentContact={editingContact}
          form={form}
          catalogs={catalogs}
          managerOptions={managerOptions}
          editContactAudit={editContactAudit}
          contactDuplicateReview={contactDuplicateReview}
          savingContact={savingContact}
          onClose={closeContactModal}
          onSubmit={saveContact}
          onDismissDuplicateReview={dismissContactDuplicateReview}
          onOpenDuplicateCandidate={openDuplicateCandidateContact}
          onChange={updateContactFormField}
          onNormalizeField={normalizeContactFormField}
          onAccountChange={handleContactAccountChange}
          getContactStatusIconBadgeClass={getContactStatusIconBadgeClass}
          getContactStatusLabel={getContactStatusLabel}
          formatDateTime={formatDateTime}
        />
      ) : null}

      {error ? <div className="toast toast-error">{error}</div> : null}
      {success ? <div className="toast toast-success">{success}</div> : null}

      {!selectedAccountId ? (
        <div className="contact-map-empty-state contact-map-empty-state-centered">
          <h3>Selecciona una cuenta para construir el mapa</h3>
          <p>
            El módulo organiza contactos por jerarquía formal y usa la
            influencia lateral como contexto del contacto seleccionado.
          </p>
        </div>
      ) : (
        <>
          <div className="contact-map-metrics-grid">
            <article className="contact-map-metric-card">
              <span>Total contactos</span>
              <strong>{metrics.total}</strong>
            </article>
            <article className="contact-map-metric-card">
              <span>Decisores clave</span>
              <strong>{metrics.keyDecisionMakers}</strong>
            </article>
            <article className="contact-map-metric-card">
              <span>Alta influencia</span>
              <strong>{metrics.highInfluence}</strong>
            </article>
            <article className="contact-map-metric-card">
              <span>Sin jefe</span>
              <strong>{metrics.withoutManager}</strong>
            </article>
          </div>

          <div className="contact-map-layout">
            <section className="contact-map-canvas-panel">
              <header className="contact-map-panel-header">
                <div>
                  <h3>{selectedAccount?.name || "Cuenta seleccionada"}</h3>
                  <p>
                    {accountContacts.length} contacto
                    {accountContacts.length === 1 ? "" : "s"} visibles en la
                    cuenta.
                  </p>
                </div>
                <div className="contact-map-panel-actions">
                  <div
                    className="contact-map-view-mode-toggle"
                    role="tablist"
                    aria-label="Modo de visualización del mapa"
                  >
                    <button
                      type="button"
                      className={`contact-map-view-mode-button${viewMode === "hierarchy" ? " is-active" : ""}`}
                      onClick={() => handleViewModeChange("hierarchy")}
                    >
                      Jerarquía
                    </button>
                    <button
                      type="button"
                      className={`contact-map-view-mode-button${viewMode === "mixed" ? " is-active" : ""}`}
                      onClick={() => handleViewModeChange("mixed")}
                    >
                      Mixto
                    </button>
                    <button
                      type="button"
                      className={`contact-map-view-mode-button${viewMode === "influence" ? " is-active" : ""}`}
                      onClick={() => handleViewModeChange("influence")}
                    >
                      Influencia
                    </button>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleCreateContactForAccount}
                  >
                    + Crear contacto
                  </button>
                </div>
              </header>

              {accountContacts.length === 0 ? (
                <div className="contact-map-empty-state">
                  <h4>Esta cuenta no tiene contactos registrados</h4>
                  <p>
                    Registra contactos primero para construir el mapa de
                    jerarquía.
                  </p>
                </div>
              ) : (
                <>
                  {!hasHierarchy ? (
                    <div className="contact-map-inline-note">
                      Aún no hay relaciones jerárquicas suficientes. El mapa
                      muestra los contactos como raíces hasta que completes el
                      campo Jefe.
                    </div>
                  ) : null}

                  <div className="contact-map-tree-scroll">
                    <div
                      className="contact-org-canvas"
                      style={{
                        width: orgChartLayout.canvasWidth,
                        height: orgChartLayout.canvasHeight,
                      }}
                    >
                      <svg
                        className="contact-org-connectors"
                        width={orgChartLayout.canvasWidth}
                        height={orgChartLayout.canvasHeight}
                        viewBox={`0 0 ${orgChartLayout.canvasWidth} ${orgChartLayout.canvasHeight}`}
                        aria-hidden="true"
                      >
                        <defs>
                          <marker
                            id="contact-org-arrow-outgoing"
                            markerWidth="10"
                            markerHeight="10"
                            refX="8"
                            refY="5"
                            orient="auto"
                            markerUnits="userSpaceOnUse"
                          >
                            <path
                              d="M 0 0 L 10 5 L 0 10 z"
                              className="contact-org-arrowhead is-outgoing"
                            />
                          </marker>
                          <marker
                            id="contact-org-arrow-incoming"
                            markerWidth="10"
                            markerHeight="10"
                            refX="8"
                            refY="5"
                            orient="auto"
                            markerUnits="userSpaceOnUse"
                          >
                            <path
                              d="M 0 0 L 10 5 L 0 10 z"
                              className="contact-org-arrowhead is-incoming"
                            />
                          </marker>
                        </defs>
                        {orgChartLayout.connectorPaths.map((connector) => (
                          <path
                            key={connector.id}
                            d={connector.d}
                            className={`contact-org-connector${viewMode === "influence" ? " is-muted" : ""}`}
                          />
                        ))}
                        {viewMode !== "hierarchy"
                          ? influenceOverlay.paths.map((connector) => (
                              <path
                                key={connector.id}
                                d={connector.d}
                                className={`contact-org-connector is-influence is-${connector.direction} tone-${connector.tone}`}
                                markerEnd={`url(#contact-org-arrow-${connector.direction})`}
                              />
                            ))
                          : null}
                      </svg>

                      {orgChartLayout.positionedNodes.map((node) => (
                        <ContactOrgNode
                          key={node.id}
                          node={node}
                          selectedContactId={selectedContactId}
                          highlightedInfluenceTargetId={
                            highlightedInfluenceTargetId
                          }
                          incomingInfluencerIds={incomingInfluencerIds}
                          shouldMute={
                            viewMode === "influence" &&
                            selectedContact &&
                            !influenceOverlay.relatedIds.has(Number(node.id))
                          }
                          onSelect={(contactId) =>
                            updateMappingSearchParam("contactId", contactId)
                          }
                          getContactStatusBadgeClass={
                            getContactStatusBadgeClass
                          }
                        />
                      ))}
                    </div>
                  </div>
                </>
              )}
            </section>

            <aside className="contact-map-detail-panel">
              {!selectedContact ? (
                <div className="contact-map-empty-state contact-map-detail-empty">
                  <h4>Selecciona un contacto</h4>
                  <p>
                    Aquí verás su contexto organizacional, su nivel comercial y
                    a quién influye dentro de la cuenta.
                  </p>
                </div>
              ) : (
                <>
                  <header className="contact-map-detail-header">
                    <div>
                      <h3>{selectedContact.full_name}</h3>
                      <p>
                        {selectedContact.position_title ||
                          "Sin cargo registrado"}
                      </p>
                    </div>
                    <span
                      className={getContactStatusBadgeClass(selectedContact)}
                    >
                      {getContactStatusLabel(selectedContact)}
                    </span>
                  </header>

                  <section className="contact-map-detail-section">
                    <span className="contact-map-detail-eyebrow">
                      Contexto organizacional
                    </span>
                    <div className="contact-map-detail-grid">
                      <div>
                        <span>Departamento</span>
                        <strong>
                          {selectedContact.department || "No registrado"}
                        </strong>
                      </div>
                      <div>
                        <span>Nivel jerárquico</span>
                        <strong>
                          {selectedContact.hierarchy_level || "No registrado"}
                        </strong>
                      </div>
                      <div>
                        <span>Jefe</span>
                        <strong>
                          {selectedContact.manager_contact_name ||
                            "Sin jefe asignado"}
                        </strong>
                      </div>
                      <div>
                        <span>Reportes directos</span>
                        <strong>
                          {contactTree.childrenByParentId.get(
                            Number(selectedContact.id),
                          )?.length || 0}
                        </strong>
                      </div>
                    </div>
                  </section>

                  <section className="contact-map-detail-section">
                    <span className="contact-map-detail-eyebrow">
                      Contexto comercial
                    </span>
                    <div className="contact-map-detail-chip-list">
                      <span
                        className={`contact-map-badge tone-${getBadgeTone(selectedContact.purchase_participation, "decision")}`}
                      >
                        {selectedContact.purchase_participation || "Sin poder"}
                      </span>
                      <span
                        className={`contact-map-badge tone-${getBadgeTone(selectedContact.relationship_type, "relationship")}`}
                      >
                        {selectedContact.relationship_type || "Sin relación"}
                      </span>
                      <span
                        className={`contact-map-badge tone-${getBadgeTone(selectedContact.influence_level, "influence")}`}
                      >
                        {selectedContact.influence_level || "Sin influencia"}
                      </span>
                    </div>
                  </section>

                  <section className="contact-map-detail-section">
                    <span className="contact-map-detail-eyebrow">
                      Relación lateral
                    </span>
                    <div className="contact-map-detail-grid contact-map-detail-grid-single">
                      <div>
                        <span>Influye en</span>
                        <strong>
                          {selectedContact.influences_contact_name ||
                            "Sin relación de influencia definida"}
                        </strong>
                      </div>
                    </div>
                    <div className="contact-map-incoming-list">
                      <span>Recibe influencia de</span>
                      {incomingInfluencers.length ? (
                        <ul>
                          {incomingInfluencers.map((contact) => (
                            <li key={contact.id}>{contact.full_name}</li>
                          ))}
                        </ul>
                      ) : (
                        <p>Ningún contacto apunta a esta persona.</p>
                      )}
                    </div>
                  </section>

                  <section className="contact-map-detail-section">
                    <span className="contact-map-detail-eyebrow">Acciones</span>
                    <div className="contact-map-detail-actions">
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => openEditContactModal(selectedContact.id)}
                      >
                        Editar contacto
                      </button>
                    </div>
                  </section>

                  {!selectedContact.manager_contact_name ||
                  (selectedContact.influences_contact_id &&
                    !selectedContact.influences_contact_name) ? (
                    <section className="contact-map-detail-section contact-map-alert-section">
                      <span className="contact-map-detail-eyebrow">
                        Alertas suaves
                      </span>
                      <ul className="contact-map-alert-list">
                        {!selectedContact.manager_contact_name ? (
                          <li>
                            Este contacto no tiene jefe asignado y aparece como
                            raíz del mapa.
                          </li>
                        ) : null}
                        {selectedContact.influences_contact_id &&
                        !selectedContact.influences_contact_name ? (
                          <li>
                            La relación de influencia apunta a un contacto que
                            no está disponible en esta cuenta.
                          </li>
                        ) : null}
                      </ul>
                    </section>
                  ) : null}
                </>
              )}
            </aside>
          </div>
        </>
      )}
    </section>
  );
}
