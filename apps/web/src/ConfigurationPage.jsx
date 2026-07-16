import { useEffect, useMemo, useState } from "react";
import { useConfigurationPage } from "./configuration/useConfigurationPage";
import "./configuration/configuration.css";

const PROPOSAL_ASSET_CATEGORIES = [
  "institutional",
  "certification",
  "partner",
  "client",
  "service",
  "brochure",
  "generic_proposal_media",
];

const PROPOSAL_ASSET_CATEGORY_LABELS = {
  institutional: "Institucional",
  certification: "Certificacion",
  partner: "Partner",
  client: "Cliente",
  service: "Servicio",
  brochure: "Folleto",
  generic_proposal_media: "Multimedia general para propuesta",
};

function getProposalAssetCategoryLabel(category) {
  return PROPOSAL_ASSET_CATEGORY_LABELS[category] || category;
}

function readLocalImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("No fue posible leer la imagen"));
    reader.readAsDataURL(file);
  });
}

function createEmptyProposalBlock(type = "paragraph") {
  return {
    type,
    text: "",
    items: type === "list" ? [""] : [],
    assetId: null,
    assetVersionId: null,
  };
}

const PROPOSAL_BLOCK_TYPE_OPTIONS = [
  ["heading", "Encabezado"],
  ["paragraph", "Parrafo"],
  ["list", "Lista"],
  ["image", "Imagen"],
];

const PROPOSAL_LAYOUT_MODE_OPTIONS = [
  ["stack", "Vertical"],
  ["horizontal-gallery", "Horizontal automatico"],
  ["manual-rows", "Manual por filas"],
];

let proposalEditorBlockSequence = 0;
let proposalManualRowSequence = 0;

function normalizeProposalLayoutMode(value) {
  const mode = String(value || "")
    .trim()
    .toLowerCase();
  return PROPOSAL_LAYOUT_MODE_OPTIONS.some(([option]) => option === mode)
    ? mode
    : "stack";
}

function createProposalEditorBlockKey(block, index = 0) {
  if (block?.blockKey) {
    return String(block.blockKey);
  }

  if (block?.id) {
    return `proposal-block-${Number(block.id)}`;
  }

  proposalEditorBlockSequence += 1;
  return `proposal-block-draft-${proposalEditorBlockSequence}-${index}-${
    block?.type || "paragraph"
  }`;
}

function createProposalEditorBlock(block, index = 0) {
  return {
    blockKey: createProposalEditorBlockKey(block, index),
    id: block?.id || null,
    type: block?.type || "paragraph",
    text: block?.text || "",
    items: Array.isArray(block?.items) ? block.items : [],
    assetId: block?.assetId || null,
    assetVersionId: block?.assetVersionId || null,
    image: block?.image || null,
  };
}

function createProposalManualRow(blockKeys = []) {
  proposalManualRowSequence += 1;
  return {
    rowId: `proposal-row-${proposalManualRowSequence}`,
    items: blockKeys.map((blockKey) => ({ blockKey })),
  };
}

function createProposalLayoutDraft(mode = "stack", manualRows = []) {
  return {
    mode: normalizeProposalLayoutMode(mode),
    manualRows: Array.isArray(manualRows) ? manualRows : [],
  };
}

function isProposalManualRowCompatibleBlock(block) {
  return (
    block?.type === "image" &&
    Boolean(block?.image?.fileUrl || (block?.assetId && block?.assetVersionId))
  );
}

function areProposalManualRowsEqual(leftRows, rightRows) {
  if (leftRows === rightRows) {
    return true;
  }

  if (!Array.isArray(leftRows) || !Array.isArray(rightRows)) {
    return false;
  }

  if (leftRows.length !== rightRows.length) {
    return false;
  }

  for (let rowIndex = 0; rowIndex < leftRows.length; rowIndex += 1) {
    const leftRow = leftRows[rowIndex];
    const rightRow = rightRows[rowIndex];
    if (leftRow?.rowId !== rightRow?.rowId) {
      return false;
    }

    const leftItems = Array.isArray(leftRow?.items) ? leftRow.items : [];
    const rightItems = Array.isArray(rightRow?.items) ? rightRow.items : [];
    if (leftItems.length !== rightItems.length) {
      return false;
    }

    for (let itemIndex = 0; itemIndex < leftItems.length; itemIndex += 1) {
      if (leftItems[itemIndex]?.blockKey !== rightItems[itemIndex]?.blockKey) {
        return false;
      }
    }
  }

  return true;
}

function reconcileProposalLayoutDraftWithBlocks(layoutDraft, blocks) {
  const compatibleBlockKeys = new Set(
    (Array.isArray(blocks) ? blocks : [])
      .filter((block) => isProposalManualRowCompatibleBlock(block))
      .map((block) => block.blockKey),
  );
  const seenBlockKeys = new Set();
  const nextManualRows = (
    Array.isArray(layoutDraft?.manualRows) ? layoutDraft.manualRows : []
  )
    .map((row) => {
      const nextItems = (Array.isArray(row?.items) ? row.items : []).filter(
        (item) => {
          if (!compatibleBlockKeys.has(item?.blockKey)) {
            return false;
          }
          if (seenBlockKeys.has(item.blockKey)) {
            return false;
          }
          seenBlockKeys.add(item.blockKey);
          return true;
        },
      );

      if (!nextItems.length) {
        return null;
      }

      return {
        rowId: row?.rowId || createProposalManualRow().rowId,
        items: nextItems,
      };
    })
    .filter(Boolean);

  const normalizedMode = normalizeProposalLayoutMode(layoutDraft?.mode);
  if (
    normalizedMode === normalizeProposalLayoutMode(layoutDraft?.mode) &&
    areProposalManualRowsEqual(layoutDraft?.manualRows, nextManualRows)
  ) {
    return layoutDraft;
  }

  return {
    mode: normalizedMode,
    manualRows: nextManualRows,
  };
}

function buildProposalLayoutDraftFromComponent(component, blocks) {
  const normalizedBlocks = Array.isArray(blocks) ? blocks : [];
  const explicitMode = normalizeProposalLayoutMode(
    component?.layoutConfig?.mode || component?.resolvedLayoutMode || "stack",
  );

  if (explicitMode !== "manual-rows") {
    return createProposalLayoutDraft(explicitMode, []);
  }

  const manualRows = (
    Array.isArray(component?.layoutConfig?.rows)
      ? component.layoutConfig.rows
      : []
  )
    .map((row) => {
      const blockKeys = (
        Array.isArray(row?.blockIndexes) ? row.blockIndexes : []
      )
        .map((blockIndex) => normalizedBlocks[Number(blockIndex)]?.blockKey)
        .filter(Boolean);

      return blockKeys.length ? createProposalManualRow(blockKeys) : null;
    })
    .filter(Boolean);

  return reconcileProposalLayoutDraftWithBlocks(
    createProposalLayoutDraft("manual-rows", manualRows),
    normalizedBlocks,
  );
}

function buildProposalLayoutConfigPayload(layoutDraft, blocks) {
  const mode = normalizeProposalLayoutMode(layoutDraft?.mode);
  if (mode !== "manual-rows") {
    return { mode };
  }

  return {
    mode,
    rows: (Array.isArray(layoutDraft?.manualRows) ? layoutDraft.manualRows : [])
      .map((row) => ({
        blockIndexes: (Array.isArray(row?.items) ? row.items : [])
          .map((item) =>
            (Array.isArray(blocks) ? blocks : []).findIndex(
              (block) => block.blockKey === item?.blockKey,
            ),
          )
          .filter((index) => index >= 0),
      }))
      .filter((row) => row.blockIndexes.length > 0),
  };
}

function getProposalManualRowLabel(rowIndex) {
  return `Fila ${rowIndex + 1}`;
}

function getProposalManualRowBlockLabel(block) {
  return (
    block?.image?.caption ||
    block?.image?.fileName ||
    block?.text ||
    "Imagen seleccionada"
  );
}

function ProposalBlockAddIcon({ type }) {
  if (type === "heading") {
    return (
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path
          fill="currentColor"
          d="M5.75 5.5a.75.75 0 0 1 .75.75v4.5h5v-4.5a.75.75 0 0 1 1.5 0v11.5a.75.75 0 0 1-1.5 0v-5.5h-5v5.5a.75.75 0 0 1-1.5 0V6.25a.75.75 0 0 1 .75-.75Zm11 0a.75.75 0 0 1 .75.75v10.8h1a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1 0-1.5h1V7h-1a.75.75 0 0 1 0-1.5h1.75Z"
        />
      </svg>
    );
  }

  if (type === "paragraph") {
    return (
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path
          fill="currentColor"
          d="M5 7.25c0-.41.34-.75.75-.75h12.5a.75.75 0 0 1 0 1.5H5.75A.75.75 0 0 1 5 7.25Zm0 4.25c0-.41.34-.75.75-.75h12.5a.75.75 0 0 1 0 1.5H5.75A.75.75 0 0 1 5 11.5Zm.75 3.5a.75.75 0 0 0 0 1.5h8.5a.75.75 0 0 0 0-1.5h-8.5Z"
        />
      </svg>
    );
  }

  if (type === "list") {
    return (
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path
          fill="currentColor"
          d="M6.25 6.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5Zm3.5.75c0-.41.34-.75.75-.75h7.75a.75.75 0 0 1 0 1.5H10.5a.75.75 0 0 1-.75-.75Zm-3.5 4a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5Zm3.5.75c0-.41.34-.75.75-.75h7.75a.75.75 0 0 1 0 1.5H10.5a.75.75 0 0 1-.75-.75Zm-3.5 4a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5Zm3.5.75c0-.41.34-.75.75-.75h7.75a.75.75 0 0 1 0 1.5H10.5a.75.75 0 0 1-.75-.75Z"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        fill="currentColor"
        d="M6.75 5A1.75 1.75 0 0 0 5 6.75v10.5C5 18.22 5.78 19 6.75 19h10.5A1.75 1.75 0 0 0 19 17.25V6.75C19 5.78 18.22 5 17.25 5H6.75Zm0 1.5h10.5c.14 0 .25.11.25.25v7.02l-2.74-2.74a1.75 1.75 0 0 0-2.47 0l-3.54 3.54-1.04-1.04a1.75 1.75 0 0 0-2.21-.22V6.75c0-.14.11-.25.25-.25Zm9 2a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5ZM6.5 17.25v-1.82l1.51-1.51a.25.25 0 0 1 .35 0l1.57 1.57 3.42-3.42a.25.25 0 0 1 .35 0l3.8 3.8v1.38a.25.25 0 0 1-.25.25H6.75a.25.25 0 0 1-.25-.25Z"
      />
    </svg>
  );
}

function ProposalWizardActionIcon({ action }) {
  if (action === "save-next") {
    return (
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path
          fill="currentColor"
          d="M6.75 4A1.75 1.75 0 0 0 5 5.75v12.5C5 19.22 5.78 20 6.75 20h10.5A1.75 1.75 0 0 0 19 18.25V8.56a1.75 1.75 0 0 0-.51-1.24l-2.81-2.81A1.75 1.75 0 0 0 14.44 4H6.75Zm0 1.5h6.5v3.25h-5.5A1.75 1.75 0 0 0 6 10.5v8h-.25a.25.25 0 0 1-.25-.25V5.75c0-.14.11-.25.25-.25Zm8 .31 2.44 2.44h-2.19a.25.25 0 0 1-.25-.25V5.81Zm-7 4.44h9a.25.25 0 0 1 .25.25v8a.25.25 0 0 1-.25.25h-9a.25.25 0 0 1-.25-.25v-8c0-.14.11-.25.25-.25Zm5.72 2.22a.75.75 0 0 1 1.06 0l1.75 1.75a.75.75 0 0 1 0 1.06l-1.75 1.75a.75.75 0 1 1-1.06-1.06l.47-.47H9.75a.75.75 0 0 1 0-1.5h4.19l-.47-.47a.75.75 0 0 1 0-1.06Z"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        fill="currentColor"
        d="M6.75 4A1.75 1.75 0 0 0 5 5.75v12.5C5 19.22 5.78 20 6.75 20h10.5A1.75 1.75 0 0 0 19 18.25V8.56a1.75 1.75 0 0 0-.51-1.24l-2.81-2.81A1.75 1.75 0 0 0 14.44 4H6.75Zm0 1.5h6.5v3.25h-5.5A1.75 1.75 0 0 0 6 10.5v8h-.25a.25.25 0 0 1-.25-.25V5.75c0-.14.11-.25.25-.25Zm8 .31 2.44 2.44h-2.19a.25.25 0 0 1-.25-.25V5.81Zm-7 4.44h9a.25.25 0 0 1 .25.25v8a.25.25 0 0 1-.25.25h-9a.25.25 0 0 1-.25-.25v-8c0-.14.11-.25.25-.25Zm1.5 1.5A.75.75 0 0 0 8.5 12.5v4a.75.75 0 0 0 1.5 0v-4a.75.75 0 0 0-.75-.75Zm2.75 0a.75.75 0 0 0 0 1.5h2a.75.75 0 0 0 0-1.5h-2Z"
      />
    </svg>
  );
}

function CreateImageIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        fill="currentColor"
        d="M6.75 5A1.75 1.75 0 0 0 5 6.75v8.5C5 16.22 5.78 17 6.75 17h6.5A1.75 1.75 0 0 0 15 15.25V6.75C15 5.78 14.22 5 13.25 5H6.75Zm0 1.5h6.5c.14 0 .25.11.25.25v8.5a.25.25 0 0 1-.25.25h-6.5a.25.25 0 0 1-.25-.25v-1.14l1.4-1.4a.25.25 0 0 1 .35 0l1.35 1.35 1.95-1.95a.25.25 0 0 1 .35 0l1.1 1.1v2.04a.75.75 0 0 0 1.5 0v-8.5C15 5.78 14.22 5 13.25 5H6.75Zm5.75 1.25a1 1 0 1 1 0 2 1 1 0 0 1 0-2ZM18 11.25a.75.75 0 0 1 .75.75v2h2a.75.75 0 0 1 0 1.5h-2v2a.75.75 0 0 1-1.5 0v-2h-2a.75.75 0 0 1 0-1.5h2v-2a.75.75 0 0 1 .75-.75Z"
      />
    </svg>
  );
}

function DeactivateImageIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        fill="currentColor"
        d="M7.75 6.5a5.75 5.75 0 1 0 0 11.5h8.5a5.75 5.75 0 0 0 0-11.5h-8.5Zm0 1.5h8.5a4.25 4.25 0 0 1 0 8.5h-8.5a4.25 4.25 0 1 1 0-8.5Zm0 1.75a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z"
      />
    </svg>
  );
}

function SelectImageFileIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 4.25a.75.75 0 0 1 .75.75v7.19l1.72-1.72a.75.75 0 1 1 1.06 1.06l-3 3a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 1 1 1.06-1.06l1.72 1.72V5a.75.75 0 0 1 .75-.75Zm-5.25 11a.75.75 0 0 1 .75.75v1.25c0 .14.11.25.25.25h8.5a.25.25 0 0 0 .25-.25V16a.75.75 0 0 1 1.5 0v1.25A1.75 1.75 0 0 1 16.25 19h-8.5A1.75 1.75 0 0 1 6 17.25V16a.75.75 0 0 1 .75-.75Z"
      />
    </svg>
  );
}

const PROPOSAL_SECTION_QUICK_TEMPLATES = {
  mission: [],
  vision: [],
  executive_summary: [
    {
      id: "problem_solution_summary",
      label: "Problema - solucion",
      description: "Resume contexto, solucion y resultado esperado.",
      title: "Resumen ejecutivo",
      blocks: [
        {
          type: "paragraph",
          text: "Esta propuesta responde a la necesidad de fortalecer la operacion comercial del cliente mediante una solucion integral, alineada con sus objetivos y su contexto actual.",
        },
        {
          type: "list",
          items: [
            "Situacion actual y oportunidad detectada",
            "Solucion propuesta y alcance general",
            "Beneficios esperados y siguientes pasos",
          ],
        },
      ],
    },
    {
      id: "decision_maker_summary",
      label: "Para toma de decision",
      description: "Mas breve y orientada a directivos.",
      title: "Resumen ejecutivo",
      blocks: [
        {
          type: "heading",
          text: "Sintesis para decision",
        },
        {
          type: "paragraph",
          text: "Presentamos una propuesta enfocada en impacto, factibilidad y velocidad de implementacion, con una ruta clara para capturar valor desde las primeras etapas.",
        },
      ],
    },
  ],
};

const PROPOSAL_TEMPLATE_VARIABLES = [
  ["{{client_name}}", "Nombre de la cuenta o cliente asociado"],
  ["{{contact_name}}", "Nombre del contacto asociado"],
  ["{{company_name}}", "Nombre visible de la empresa emisora"],
];

const PROPOSAL_TEMPLATE_VARIABLE_NAMES = new Set(
  PROPOSAL_TEMPLATE_VARIABLES.map(([token]) =>
    token.replaceAll("{{", "").replaceAll("}}", "").trim(),
  ),
);

function getInvalidProposalPlaceholderTokens(text) {
  const matches = String(text || "").matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g);
  const invalidTokens = [];

  for (const match of matches) {
    const tokenName = String(match[1] || "").trim();
    if (!PROPOSAL_TEMPLATE_VARIABLE_NAMES.has(tokenName)) {
      invalidTokens.push(`{{${tokenName}}}`);
    }
  }

  return [...new Set(invalidTokens)];
}

function getProposalBlockInvalidPlaceholderTokens(block) {
  if (!block) return [];

  if (block.type === "heading" || block.type === "paragraph") {
    return getInvalidProposalPlaceholderTokens(block.text);
  }

  if (block.type === "list") {
    return [
      ...new Set(
        (Array.isArray(block.items) ? block.items : []).flatMap((item) =>
          getInvalidProposalPlaceholderTokens(item),
        ),
      ),
    ];
  }

  return [];
}

function getProposalBlockTypeLabel(type) {
  return (
    PROPOSAL_BLOCK_TYPE_OPTIONS.find(([value]) => value === type)?.[1] ||
    "Bloque"
  );
}

function createProposalBlocksFromTemplate(template) {
  return (template.blocks || []).map((block, index) =>
    createProposalEditorBlock(
      {
        id: null,
        type: block.type || "paragraph",
        text: block.text || "",
        items: Array.isArray(block.items) ? [...block.items] : [],
        assetId: block.assetId || null,
        assetVersionId: block.assetVersionId || null,
        image: block.image || null,
      },
      index,
    ),
  );
}

function ConfigurationSummaryList({ items }) {
  return (
    <dl className="configuration-summary-list">
      {items.map((item) => (
        <div key={item.label} className="configuration-summary-row">
          <dt>{item.label}</dt>
          <dd>{item.value || "Sin definir"}</dd>
        </div>
      ))}
    </dl>
  );
}

function ConfigurationChecklist({ title, description, items }) {
  return (
    <section className="configuration-card">
      <div className="configuration-card-heading">
        <div>
          <h4>{title}</h4>
          <p>{description}</p>
        </div>
      </div>
      <div className="configuration-checklist">
        {items.map((item) => (
          <article
            key={item.label}
            className={`configuration-checklist-item ${
              item.complete ? "is-complete" : "is-pending"
            }`}
          >
            <div>
              <strong>{item.label}</strong>
              <p>{item.description}</p>
            </div>
            <span>{item.complete ? "Completo" : "Pendiente"}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function ConfigurationBrandingPreview({
  logoUrl,
  legalName,
  taxId,
  lines,
  email,
  phone,
}) {
  return (
    <section className="configuration-card configuration-branding-card">
      <div className="configuration-card-heading">
        <div>
          <h4>Branding documental activo</h4>
          <p>
            Este bloque se reutiliza en la salida documental de cotizaciones.
          </p>
        </div>
      </div>

      <div className="configuration-branding-preview">
        <div className="configuration-branding-logo-shell">
          {logoUrl ? (
            <img src={logoUrl} alt="Logo institucional en documentos" />
          ) : (
            <div className="configuration-logo-empty">Sin logo configurado</div>
          )}
        </div>

        <div className="configuration-branding-copy">
          <strong>{legalName || "Sin razon social"}</strong>
          <span>{taxId || "Sin registro fiscal"}</span>
          {lines.map((line) => (
            <span key={line}>{line}</span>
          ))}
          {email ? <span>{email}</span> : null}
          {phone ? <span>{phone}</span> : null}
        </div>
      </div>
    </section>
  );
}

function AiCreditConfigurationPanel({
  items,
  loading,
  error,
  latestUpdateText,
  pricingRates,
  pricingRatesLoading,
  pricingRatesError,
  latestPricingUpdateText,
  pricingActionKey,
  pricingSyncPreview,
  selectedUserId,
  selectedDetail,
  detailLoading,
  actionKey,
  onSelectUser,
  onGrantCredit,
  onAdjustCredit,
  onUpdatePolicy,
  onCreatePricingRate,
  onClosePricingRate,
  onSyncPricingRates,
}) {
  const [filterText, setFilterText] = useState("");
  const [grantAmountUsd, setGrantAmountUsd] = useState("5.00");
  const [grantReasonCode, setGrantReasonCode] = useState("manual_topup");
  const [grantReasonText, setGrantReasonText] = useState(
    "Recarga de crédito IA",
  );
  const [adjustAmountUsd, setAdjustAmountUsd] = useState("");
  const [adjustReasonCode, setAdjustReasonCode] = useState("manual_adjustment");
  const [adjustReasonText, setAdjustReasonText] = useState("");
  const [policyDraft, setPolicyDraft] = useState({
    hardLimitEnabled: true,
    warningThresholdPercent: 80,
    criticalThresholdPercent: 95,
  });
  const [newPricingModel, setNewPricingModel] = useState("");
  const [newPricingInputMicros, setNewPricingInputMicros] = useState("300000");
  const [newPricingOutputMicros, setNewPricingOutputMicros] =
    useState("1200000");
  const [newPricingCachedMicros, setNewPricingCachedMicros] = useState("30000");
  const [newPricingValidFromUtc, setNewPricingValidFromUtc] = useState("");

  const moneyMicrosFormatter = useMemo(
    () =>
      new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 4,
        maximumFractionDigits: 6,
      }),
    [],
  );

  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [],
  );

  const selectedWallet = selectedDetail?.wallet || null;
  const selectedUser = useMemo(
    () =>
      items.find((item) => Number(item.userId) === Number(selectedUserId)) ||
      items[0] ||
      null,
    [items, selectedUserId],
  );
  const selectedVisibleUser = selectedWallet || selectedUser;

  useEffect(() => {
    if (!selectedVisibleUser) return;
    setPolicyDraft({
      hardLimitEnabled: Boolean(selectedVisibleUser.hardLimitEnabled),
      warningThresholdPercent: Number(
        selectedVisibleUser.warningThresholdPercent || 80,
      ),
      criticalThresholdPercent: Number(
        selectedVisibleUser.criticalThresholdPercent || 95,
      ),
    });
  }, [selectedVisibleUser?.userId, selectedVisibleUser?.updatedAtUtc]);

  const filteredItems = useMemo(() => {
    const normalizedFilter = String(filterText || "")
      .toLowerCase()
      .trim();
    if (!normalizedFilter) return items;
    return items.filter((item) => {
      const haystack = [item.fullName, item.email, item.roles, item.state]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedFilter);
    });
  }, [filterText, items]);

  const summary = useMemo(() => {
    return filteredItems.reduce(
      (accumulator, item) => {
        accumulator.totalGranted += Number(item.lifetimeGrantedUsd || 0);
        accumulator.totalConsumed += Number(item.lifetimeConsumedUsd || 0);
        accumulator.totalBalance += Number(item.balanceUsd || 0);
        accumulator[item.state || "normal"] += 1;
        return accumulator;
      },
      {
        totalGranted: 0,
        totalConsumed: 0,
        totalBalance: 0,
        normal: 0,
        warning: 0,
        critical: 0,
        exhausted: 0,
      },
    );
  }, [filteredItems]);

  const groupedPricingRates = useMemo(() => {
    if (!Array.isArray(pricingRates)) return [];
    const byModel = new Map();
    pricingRates.forEach((rate) => {
      const key = `${rate.provider}:${rate.model}`;
      if (!byModel.has(key)) {
        byModel.set(key, {
          provider: rate.provider,
          model: rate.model,
          rows: [],
        });
      }
      byModel.get(key).rows.push(rate);
    });
    return Array.from(byModel.values());
  }, [pricingRates]);

  async function submitNewPricingRate(event) {
    event.preventDefault();
    const payload = {
      provider: "openai",
      model: String(newPricingModel || "").trim(),
      inputUsdPerMillionMicros: Number(newPricingInputMicros || 0),
      outputUsdPerMillionMicros: Number(newPricingOutputMicros || 0),
      cachedInputUsdPerMillionMicros: Number(newPricingCachedMicros || 0),
      validFromUtc:
        newPricingValidFromUtc && String(newPricingValidFromUtc).trim()
          ? new Date(newPricingValidFromUtc).toISOString()
          : undefined,
      source: "manual_admin",
      sourceReference: "configuration_ui",
    };
    await onCreatePricingRate(payload);
    setNewPricingModel("");
    setNewPricingValidFromUtc("");
  }

  async function submitGrant(event) {
    event.preventDefault();
    if (!selectedVisibleUser?.userId) return;
    await onGrantCredit(selectedVisibleUser.userId, {
      amountUsd: Number(grantAmountUsd),
      reasonCode: String(grantReasonCode || "manual_topup").trim(),
      reasonText: String(grantReasonText || "").trim(),
      idempotencyKey:
        window.crypto?.randomUUID?.() ||
        `grant-${selectedVisibleUser.userId}-${Date.now()}`,
    });
  }

  async function submitAdjustment(event) {
    event.preventDefault();
    if (!selectedVisibleUser?.userId) return;
    await onAdjustCredit(selectedVisibleUser.userId, {
      amountUsd: Number(adjustAmountUsd),
      reasonCode: String(adjustReasonCode || "manual_adjustment").trim(),
      reasonText: String(adjustReasonText || "").trim(),
      idempotencyKey:
        window.crypto?.randomUUID?.() ||
        `adjust-${selectedVisibleUser.userId}-${Date.now()}`,
    });
    setAdjustAmountUsd("");
    setAdjustReasonText("");
  }

  async function submitPolicy(event) {
    event.preventDefault();
    if (!selectedVisibleUser?.userId) return;
    await onUpdatePolicy(selectedVisibleUser.userId, {
      hardLimitEnabled: Boolean(policyDraft.hardLimitEnabled),
      warningThresholdPercent: Number(policyDraft.warningThresholdPercent),
      criticalThresholdPercent: Number(policyDraft.criticalThresholdPercent),
    });
  }

  return (
    <div className="configuration-section-stack">
      <section className="configuration-card ai-credit-card">
        <div className="configuration-card-heading">
          <div>
            <h4>Credito IA</h4>
            <p>
              Gestiona el saldo por usuario, sus umbrales de consumo y el
              historial de movimientos.
            </p>
          </div>
          <span className="configuration-inline-pill">{latestUpdateText}</span>
        </div>

        <div className="ai-credit-summary-grid">
          <article className="ai-credit-summary-card">
            <strong>
              {currencyFormatter.format(summary.totalGranted || 0)}
            </strong>
            <span>Credito total asignado</span>
          </article>
          <article className="ai-credit-summary-card">
            <strong>
              {currencyFormatter.format(summary.totalConsumed || 0)}
            </strong>
            <span>Consumo acumulado</span>
          </article>
          <article className="ai-credit-summary-card">
            <strong>
              {currencyFormatter.format(summary.totalBalance || 0)}
            </strong>
            <span>Saldo disponible</span>
          </article>
          <article className="ai-credit-summary-card">
            <strong>{filteredItems.length}</strong>
            <span>Usuarios visibles</span>
          </article>
        </div>

        <div className="ai-credit-toolbar">
          <input
            type="search"
            value={filterText}
            onChange={(event) => setFilterText(event.target.value)}
            placeholder="Buscar por nombre, correo, rol o estado"
          />
          <button
            type="button"
            className="btn-secondary"
            onClick={() => onSelectUser(selectedVisibleUser?.userId || null)}
          >
            Refrescar detalle
          </button>
        </div>

        {loading ? <p className="field-hint">Cargando crédito IA...</p> : null}
        {error ? <p className="field-error-text">{error}</p> : null}

        <div className="ai-credit-table-wrap">
          <table className="configuration-table ai-credit-table">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Saldo</th>
                <th>Consumido</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr
                  key={item.userId}
                  className={
                    Number(item.userId) === Number(selectedUserId)
                      ? "is-selected"
                      : ""
                  }
                  onClick={() => void onSelectUser(item.userId)}
                >
                  <td>
                    <strong>{item.fullName}</strong>
                    <span>{item.email}</span>
                    <small>{item.roles || "Sin roles"}</small>
                  </td>
                  <td>{currencyFormatter.format(item.balanceUsd || 0)}</td>
                  <td>
                    <div className="ai-credit-row-progress">
                      <div className="ai-credit-row-track" aria-hidden="true">
                        <span
                          className={`ai-credit-row-fill state-${item.state}`}
                          style={{
                            width: `${Math.max(0, Math.min(100, item.consumedPercent || 0))}%`,
                          }}
                        />
                      </div>
                      <span>
                        {Math.max(0, Math.min(100, item.consumedPercent || 0))}%
                      </span>
                    </div>
                  </td>
                  <td>
                    <span
                      className={`configuration-status-pill ai-credit-state-${item.state}`}
                    >
                      {item.state}
                    </span>
                  </td>
                </tr>
              ))}
              {!filteredItems.length ? (
                <tr>
                  <td colSpan="4">
                    <p className="field-hint">
                      No hay usuarios para mostrar con ese filtro.
                    </p>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="configuration-card ai-credit-detail-card">
        <div className="configuration-card-heading">
          <div>
            <h4>Detalle por usuario</h4>
            <p>
              Selecciona un usuario para ver su saldo, políticas y movimientos
              recientes.
            </p>
          </div>
          {selectedVisibleUser ? (
            <span className="configuration-inline-pill">
              {selectedVisibleUser.fullName || selectedVisibleUser.email}
            </span>
          ) : null}
        </div>

        {!selectedVisibleUser ? (
          <p className="field-hint">
            Selecciona un usuario para administrar su crédito IA.
          </p>
        ) : (
          <div className="ai-credit-detail-grid">
            <div className="ai-credit-detail-summary">
              <div>
                <strong>{selectedVisibleUser.fullName}</strong>
                <p>{selectedVisibleUser.email}</p>
                <span>{selectedVisibleUser.roles || "Sin roles"}</span>
              </div>
              <div className="ai-credit-detail-metrics">
                <article>
                  <strong>
                    {currencyFormatter.format(
                      selectedVisibleUser.balanceUsd || 0,
                    )}
                  </strong>
                  <span>Disponible</span>
                </article>
                <article>
                  <strong>
                    {currencyFormatter.format(
                      selectedVisibleUser.lifetimeConsumedUsd || 0,
                    )}
                  </strong>
                  <span>Consumido</span>
                </article>
                <article>
                  <strong>
                    {currencyFormatter.format(
                      selectedVisibleUser.lifetimeGrantedUsd || 0,
                    )}
                  </strong>
                  <span>Asignado</span>
                </article>
                <article>
                  <strong>{selectedVisibleUser.state}</strong>
                  <span>Estado</span>
                </article>
              </div>
            </div>

            <form className="ai-credit-form" onSubmit={submitGrant}>
              <h5>Recargar crédito</h5>
              <div className="configuration-form-grid">
                <div className="field-group">
                  <label>Monto USD</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={grantAmountUsd}
                    onChange={(event) => setGrantAmountUsd(event.target.value)}
                  />
                </div>
                <div className="field-group">
                  <label>Codigo motivo</label>
                  <input
                    type="text"
                    value={grantReasonCode}
                    onChange={(event) => setGrantReasonCode(event.target.value)}
                  />
                </div>
                <div className="field-group configuration-grid-span-full">
                  <label>Motivo</label>
                  <textarea
                    rows="2"
                    value={grantReasonText}
                    onChange={(event) => setGrantReasonText(event.target.value)}
                  />
                </div>
              </div>
              <button
                type="submit"
                className="btn-primary"
                disabled={actionKey === `grant:${selectedVisibleUser.userId}`}
              >
                {actionKey === `grant:${selectedVisibleUser.userId}`
                  ? "Guardando..."
                  : "Recargar crédito"}
              </button>
            </form>

            <form className="ai-credit-form" onSubmit={submitAdjustment}>
              <h5>Ajuste manual</h5>
              <div className="configuration-form-grid">
                <div className="field-group">
                  <label>Monto USD</label>
                  <input
                    type="number"
                    step="0.01"
                    value={adjustAmountUsd}
                    onChange={(event) => setAdjustAmountUsd(event.target.value)}
                    placeholder="Usa negativo para descontar"
                  />
                </div>
                <div className="field-group">
                  <label>Codigo motivo</label>
                  <input
                    type="text"
                    value={adjustReasonCode}
                    onChange={(event) =>
                      setAdjustReasonCode(event.target.value)
                    }
                  />
                </div>
                <div className="field-group configuration-grid-span-full">
                  <label>Motivo obligatorio</label>
                  <textarea
                    rows="2"
                    value={adjustReasonText}
                    onChange={(event) =>
                      setAdjustReasonText(event.target.value)
                    }
                    placeholder="Explica por que se corrige el saldo"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="btn-secondary"
                disabled={actionKey === `adjust:${selectedVisibleUser.userId}`}
              >
                {actionKey === `adjust:${selectedVisibleUser.userId}`
                  ? "Aplicando..."
                  : "Aplicar ajuste"}
              </button>
            </form>

            <form className="ai-credit-form" onSubmit={submitPolicy}>
              <h5>Política del usuario</h5>
              <div className="configuration-form-grid">
                <label className="configuration-toggle-row configuration-grid-span-full">
                  <div className="configuration-toggle-copy">
                    <strong>Hard limit</strong>
                    <p>Bloquea la IA cuando el saldo llegue a cero.</p>
                  </div>
                  <span className="configuration-toggle-control">
                    <input
                      type="checkbox"
                      checked={Boolean(policyDraft.hardLimitEnabled)}
                      onChange={(event) =>
                        setPolicyDraft((current) => ({
                          ...current,
                          hardLimitEnabled: event.target.checked,
                        }))
                      }
                    />
                  </span>
                </label>
                <div className="field-group">
                  <label>Umbral warning %</label>
                  <input
                    type="number"
                    min="1"
                    max="99"
                    value={policyDraft.warningThresholdPercent}
                    onChange={(event) =>
                      setPolicyDraft((current) => ({
                        ...current,
                        warningThresholdPercent: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="field-group">
                  <label>Umbral critical %</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={policyDraft.criticalThresholdPercent}
                    onChange={(event) =>
                      setPolicyDraft((current) => ({
                        ...current,
                        criticalThresholdPercent: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <button
                type="submit"
                className="btn-secondary"
                disabled={actionKey === `policy:${selectedVisibleUser.userId}`}
              >
                {actionKey === `policy:${selectedVisibleUser.userId}`
                  ? "Guardando..."
                  : "Guardar política"}
              </button>
            </form>

            <div className="ai-credit-history">
              <h5>Movimientos recientes</h5>
              {detailLoading ? (
                <p className="field-hint">Cargando detalle...</p>
              ) : selectedDetail?.recentTransactions?.length ? (
                <div className="configuration-audit-list ai-credit-history-list">
                  {selectedDetail.recentTransactions.map((movement) => (
                    <article
                      key={movement.id}
                      className="configuration-audit-item"
                    >
                      <div>
                        <strong>{movement.transactionType}</strong>
                        <p>{movement.reasonText || movement.reasonCode}</p>
                      </div>
                      <span>
                        {currencyFormatter.format(movement.amountUsd || 0)} ·{" "}
                        {movement.createdAtUtc
                          ? new Date(movement.createdAtUtc).toLocaleString()
                          : ""}
                      </span>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="field-hint">
                  No hay movimientos recientes para este usuario.
                </p>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="configuration-card ai-pricing-card">
        <div className="configuration-card-heading">
          <div>
            <h4>Tarifas IA por modelo</h4>
            <p>
              Controla costos por millon de tokens y su vigencia para cada
              modelo.
            </p>
          </div>
          <span className="configuration-inline-pill">
            {latestPricingUpdateText}
          </span>
        </div>

        <div className="ai-pricing-toolbar">
          <button
            type="button"
            className="btn-secondary"
            disabled={pricingActionKey === "sync-preview"}
            onClick={() => {
              void onSyncPricingRates({ dryRun: true });
            }}
          >
            {pricingActionKey === "sync-preview"
              ? "Consultando..."
              : "⟳ Obtener automaticamente"}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={
              pricingActionKey === "sync-apply" || !pricingSyncPreview.length
            }
            onClick={() => {
              void onSyncPricingRates({ dryRun: false });
            }}
          >
            {pricingActionKey === "sync-apply"
              ? "Aplicando..."
              : "Aplicar sincronizacion"}
          </button>
        </div>

        {pricingRatesLoading ? (
          <p className="field-hint">Cargando tarifas IA...</p>
        ) : null}
        {pricingRatesError ? (
          <p className="field-error-text">{pricingRatesError}</p>
        ) : null}

        {pricingSyncPreview.length ? (
          <div className="ai-pricing-preview">
            {pricingSyncPreview.map((item) => (
              <article
                key={`${item.provider}:${item.model}`}
                className={`ai-pricing-preview-item change-${item.changeType}`}
              >
                <strong>
                  {item.provider} · {item.model}
                </strong>
                <span>
                  {item.changeType === "unchanged"
                    ? "Sin cambios"
                    : item.changeType === "create"
                      ? "Nueva tarifa"
                      : "Actualizacion de tarifa"}
                </span>
              </article>
            ))}
          </div>
        ) : null}

        <div className="ai-pricing-table-wrap">
          <table className="configuration-table ai-pricing-table">
            <thead>
              <tr>
                <th>Modelo</th>
                <th>Input / M</th>
                <th>Output / M</th>
                <th>Cached / M</th>
                <th>Vigencia</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {groupedPricingRates.map((group) =>
                group.rows.map((rate) => (
                  <tr key={rate.id}>
                    <td>
                      <strong>{rate.model}</strong>
                      <span>{rate.provider}</span>
                    </td>
                    <td>
                      {moneyMicrosFormatter.format(
                        (rate.inputUsdPerMillionMicros || 0) / 1000000,
                      )}
                    </td>
                    <td>
                      {moneyMicrosFormatter.format(
                        (rate.outputUsdPerMillionMicros || 0) / 1000000,
                      )}
                    </td>
                    <td>
                      {moneyMicrosFormatter.format(
                        (rate.cachedInputUsdPerMillionMicros || 0) / 1000000,
                      )}
                    </td>
                    <td>
                      <strong>
                        {rate.validFromUtc
                          ? new Date(rate.validFromUtc).toLocaleString()
                          : "-"}
                      </strong>
                      <span>
                        {rate.validToUtc
                          ? `Hasta ${new Date(rate.validToUtc).toLocaleString()}`
                          : "Sin fin"}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`configuration-status-pill ai-pricing-state-${rate.state}`}
                      >
                        {rate.state}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={
                          rate.state !== "active" ||
                          pricingActionKey === `close:${rate.id}`
                        }
                        onClick={() => {
                          void onClosePricingRate(rate.id, {});
                        }}
                      >
                        {pricingActionKey === `close:${rate.id}`
                          ? "Cerrando..."
                          : "Cerrar vigencia"}
                      </button>
                    </td>
                  </tr>
                )),
              )}
              {!groupedPricingRates.length ? (
                <tr>
                  <td colSpan="7">
                    <p className="field-hint">No hay tarifas registradas.</p>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <form className="ai-credit-form" onSubmit={submitNewPricingRate}>
          <h5>Nueva tarifa manual</h5>
          <div className="configuration-form-grid">
            <div className="field-group">
              <label>Modelo</label>
              <input
                type="text"
                value={newPricingModel}
                onChange={(event) => setNewPricingModel(event.target.value)}
                placeholder="gpt-4.1-mini"
                required
              />
            </div>
            <div className="field-group">
              <label>Vigente desde</label>
              <input
                type="datetime-local"
                value={newPricingValidFromUtc}
                onChange={(event) =>
                  setNewPricingValidFromUtc(event.target.value)
                }
              />
            </div>
            <div className="field-group">
              <label>Input micros por millon</label>
              <input
                type="number"
                min="0"
                step="1"
                value={newPricingInputMicros}
                onChange={(event) =>
                  setNewPricingInputMicros(event.target.value)
                }
                required
              />
            </div>
            <div className="field-group">
              <label>Output micros por millon</label>
              <input
                type="number"
                min="0"
                step="1"
                value={newPricingOutputMicros}
                onChange={(event) =>
                  setNewPricingOutputMicros(event.target.value)
                }
                required
              />
            </div>
            <div className="field-group configuration-grid-span-full">
              <label>Cached input micros por millon</label>
              <input
                type="number"
                min="0"
                step="1"
                value={newPricingCachedMicros}
                onChange={(event) =>
                  setNewPricingCachedMicros(event.target.value)
                }
              />
            </div>
          </div>
          <button
            type="submit"
            className="btn-primary"
            disabled={pricingActionKey === "create"}
          >
            {pricingActionKey === "create" ? "Guardando..." : "Crear tarifa"}
          </button>
        </form>
      </section>
    </div>
  );
}

function TemporaryFeaturesCard({
  settings,
  latestUpdateText,
  saving,
  canSave,
  isDirty,
  onToggle,
  onSave,
}) {
  const items = [
    {
      key: "accountsPendingEnabled",
      title: "Cuentas pendientes",
      description:
        "Si esta activo, request crea cuentas pendientes y create puede aprobar o crear activas.",
    },
    {
      key: "contactsPendingEnabled",
      title: "Contactos pendientes",
      description:
        "Define si la creacion manual con request genera contactos pendientes.",
    },
    {
      key: "opportunitiesPendingEnabled",
      title: "Oportunidades pendientes",
      description:
        "Habilita solicitudes manuales pendientes y su aprobacion desde listados.",
    },
  ];

  return (
    <section className="configuration-card">
      <div className="configuration-card-heading">
        <div>
          <h4>Temporales</h4>
          <p>
            Controla en que modulos existe el flujo de solicitud y aprobacion
            manual por estado pendiente.
          </p>
        </div>
        <span className="configuration-inline-pill">
          {isDirty ? "Cambios pendientes" : "Sincronizado"}
        </span>
      </div>

      <div className="configuration-temporary-grid">
        {items.map((item) => (
          <label key={item.key} className="configuration-toggle-row">
            <div className="configuration-toggle-copy">
              <strong>{item.title}</strong>
              <p>{item.description}</p>
            </div>
            <span className="configuration-toggle-control">
              <input
                type="checkbox"
                checked={Boolean(settings[item.key])}
                onChange={(event) => onToggle(item.key, event.target.checked)}
              />
            </span>
          </label>
        ))}
      </div>

      <div className="configuration-temporary-footer">
        <span className="field-hint">
          Ultima actualizacion: {latestUpdateText}
        </span>
        <button
          type="button"
          className="btn-primary"
          onClick={onSave}
          disabled={saving || !canSave}
        >
          {saving ? "Guardando..." : "Guardar temporales"}
        </button>
      </div>
    </section>
  );
}

function ChatbotSettingsCard({
  settings,
  latestUpdateText,
  saving,
  canSave,
  isDirty,
  onChange,
  onSave,
}) {
  return (
    <section className="configuration-card">
      <div className="configuration-card-heading">
        <div>
          <h4>Chatbot</h4>
          <p>
            Ajusta el tiempo maximo de espera para las solicitudes del chatbot
            desde el frontend.
          </p>
        </div>
        <span className="configuration-inline-pill">
          {isDirty ? "Cambios pendientes" : "Sincronizado"}
        </span>
      </div>

      <div className="configuration-form-grid">
        <div className="field-group configuration-grid-span-full">
          <label>Timeout de solicitud (ms)</label>
          <input
            type="number"
            min="5000"
            max="300000"
            step="1000"
            value={settings.requestTimeoutMs}
            onChange={(event) =>
              onChange("requestTimeoutMs", Number(event.target.value || 0))
            }
          />
          <p className="field-hint">
            Valor recomendado: 60000 ms. El chatbot usara este limite para abrir
            sesiones, cargar historial y enviar mensajes.
          </p>
        </div>
      </div>

      <div className="configuration-temporary-footer">
        <span className="field-hint">
          Ultima actualizacion: {latestUpdateText}
        </span>
        <button
          type="button"
          className="btn-primary"
          onClick={onSave}
          disabled={saving || !canSave}
        >
          {saving ? "Guardando..." : "Guardar chatbot"}
        </button>
      </div>
    </section>
  );
}

function CommercialSettingsCard({
  settings,
  stageSlaEntries,
  stageWeightEntries,
  leadExecutionGuideEntries,
  campaignMatrixCatalogs,
  latestUpdateText,
  saving,
  canSave,
  isDirty,
  onChange,
  onTimezoneChange,
  onScreenDisplayMinutesChange,
  onScreenRotationMinutesChange,
  onWeightChange,
  onGuideChange,
  onMatrixRowChange,
  onAddMatrixRow,
  onRemoveMatrixRow,
  onSave,
}) {
  const commonTimezones = [
    "America/Mexico_City",
    "America/Bogota",
    "America/Lima",
    "America/Santiago",
    "America/Argentina/Buenos_Aires",
    "America/New_York",
    "UTC",
  ];
  const formatOptionLabel = (value) =>
    String(value || "")
      .replaceAll("_", " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());

  return (
    <section className="configuration-card">
      <div className="configuration-card-heading">
        <div>
          <h4>SLA por etapa comercial</h4>
          <p>
            Define el máximo de días sin actividad registrada por etapa antes de
            que una oportunidad sea marcada como rezagada.
          </p>
        </div>
        <span className="configuration-inline-pill">
          {isDirty ? "Cambios pendientes" : "Sincronizado"}
        </span>
      </div>

      <div className="configuration-form-grid">
        <div className="field-group configuration-grid-span-full">
          <label>Zona horaria oficial (IANA)</label>
          <input
            type="text"
            list="commercial-timezone-options"
            value={settings.businessTimezone || "America/Mexico_City"}
            onChange={(event) => onTimezoneChange(event.target.value)}
            placeholder="Ej. America/Mexico_City"
          />
          <datalist id="commercial-timezone-options">
            {commonTimezones.map((timezone) => (
              <option key={timezone} value={timezone} />
            ))}
          </datalist>
          <p className="field-hint">
            Usa formato IANA (por ejemplo: America/Mexico_City).
          </p>
        </div>

        <div className="field-group">
          <label>Minutos de refresco (Ritmo comercial TV)</label>
          <input
            type="number"
            min="1"
            max="60"
            step="1"
            value={settings.sellerLeagueScreenDisplayMinutes ?? 1}
            onChange={(event) =>
              onScreenDisplayMinutesChange(Number(event.target.value || 1))
            }
          />
          <p className="field-hint">
            Define cada cuántos minutos se recargan automáticamente los datos en la pantalla de Liga TV.
          </p>
        </div>

        <div className="field-group">
          <label>Minutos por pantalla (Rotación Liga TV)</label>
          <input
            type="number"
            min="1"
            max="60"
            step="1"
            value={settings.sellerLeagueScreenRotationMinutes ?? 1}
            onChange={(event) =>
              onScreenRotationMinutesChange(Number(event.target.value || 1))
            }
          />
          <p className="field-hint">
            Define cuántos minutos permanece visible cada pantalla antes de pasar a la siguiente en la Liga TV.
          </p>
        </div>

        {stageSlaEntries.map((entry) => (
          <div key={entry.code} className="field-group">
            <label>{entry.label}</label>
            <input
              type="number"
              min="1"
              max="90"
              step="1"
              value={settings.stageSlaMap?.[entry.code] ?? 5}
              onChange={(event) =>
                onChange(entry.code, Number(event.target.value || 1))
              }
            />
          </div>
        ))}
      </div>

      <div className="configuration-card-heading">
        <div>
          <h4>Pesos de forecast por etapa (%)</h4>
          <p>
            Ajusta el porcentaje base de ponderación usado para estimar forecast
            mensual por etapa comercial.
          </p>
        </div>
      </div>

      <div className="configuration-form-grid">
        {stageWeightEntries.map((entry) => (
          <div key={entry.code} className="field-group">
            <label>{entry.label}</label>
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              value={Math.round(
                (settings.stageWeightMap?.[entry.code] ?? 0) * 100,
              )}
              onChange={(event) =>
                onWeightChange(entry.code, Number(event.target.value || 0))
              }
            />
          </div>
        ))}
      </div>

      <div className="configuration-card-heading">
        <div>
          <h4>Guías de ejecución para leads</h4>
          <p>
            Ajusta el texto que se muestra en el modal de guía por cada etapa de
            la secuencia comercial.
          </p>
        </div>
      </div>

      <div className="configuration-form-grid">
        {leadExecutionGuideEntries.map((entry) => (
          <div
            key={entry.key}
            className="field-group configuration-grid-span-full"
          >
            <label>{entry.label}</label>
            <textarea
              rows={3}
              value={settings.leadExecutionGuides?.[entry.key] || ""}
              onChange={(event) => onGuideChange(entry.key, event.target.value)}
              placeholder="Escribe la guía para esta etapa"
            />
          </div>
        ))}
      </div>

      <div className="configuration-card-heading">
        <div>
          <h4>Matriz de campañas</h4>
          <p>
            Edita cada combinación de tipo, prioridad, subtipo y tipo de correo.
            Puedes agregar filas nuevas o eliminar las existentes.
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary"
          onClick={onAddMatrixRow}
        >
          Agregar fila
        </button>
      </div>

      <div className="configuration-table-wrapper">
        <table className="configuration-table">
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Prioridad</th>
              <th>Subtipo</th>
              <th>Tipo de correo</th>
              <th>Ejemplo</th>
              <th>Requisito operativo</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {(settings.campaignMatrixRows || []).map((row) => (
              <tr key={row.id}>
                <td>
                  <select
                    value={row.campaignType || ""}
                    onChange={(event) =>
                      onMatrixRowChange(
                        row.id,
                        "campaignType",
                        event.target.value,
                      )
                    }
                  >
                    {campaignMatrixCatalogs.campaignTypes.map((value) => (
                      <option key={value} value={value}>
                        {formatOptionLabel(value)}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={row.priority || ""}
                    onChange={(event) =>
                      onMatrixRowChange(row.id, "priority", event.target.value)
                    }
                  >
                    {campaignMatrixCatalogs.priorities.map((value) => (
                      <option key={value} value={value}>
                        {formatOptionLabel(value)}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={row.campaignSubtype || ""}
                    onChange={(event) =>
                      onMatrixRowChange(
                        row.id,
                        "campaignSubtype",
                        event.target.value,
                      )
                    }
                  >
                    {campaignMatrixCatalogs.campaignSubtypes.map((value) => (
                      <option key={value} value={value}>
                        {formatOptionLabel(value)}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={row.emailType || ""}
                    onChange={(event) =>
                      onMatrixRowChange(row.id, "emailType", event.target.value)
                    }
                  >
                    {campaignMatrixCatalogs.emailTypes.map((value) => (
                      <option key={value} value={value}>
                        {formatOptionLabel(value)}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <textarea
                    rows={3}
                    value={row.exampleEmail || ""}
                    onChange={(event) =>
                      onMatrixRowChange(
                        row.id,
                        "exampleEmail",
                        event.target.value,
                      )
                    }
                    placeholder="Asunto y cuerpo resumido"
                  />
                </td>
                <td>
                  <textarea
                    rows={3}
                    value={row.operationalRequirement || ""}
                    onChange={(event) =>
                      onMatrixRowChange(
                        row.id,
                        "operationalRequirement",
                        event.target.value,
                      )
                    }
                    placeholder="Requisito operativo"
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => onRemoveMatrixRow(row.id)}
                  >
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="configuration-temporary-footer">
        <span className="field-hint">
          Ultima actualizacion: {latestUpdateText}
        </span>
        <button
          type="button"
          className="btn-primary"
          onClick={onSave}
          disabled={saving || !canSave}
        >
          {saving ? "Guardando..." : "Guardar configuracion comercial"}
        </button>
      </div>
    </section>
  );
}

function ConfigurationModuleCards({ items, onOpenAudit }) {
  return (
    <div className="configuration-module-grid">
      {items.map((item) => (
        <section key={item.title} className="configuration-card">
          <div className="configuration-card-heading">
            <div>
              <h4>{item.title}</h4>
              <p>{item.description}</p>
            </div>
            {item.badge ? (
              <span className="configuration-inline-pill">{item.badge}</span>
            ) : null}
          </div>

          <ul className="configuration-bullet-list">
            {item.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>

          {item.action === "audit" ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={onOpenAudit}
            >
              Abrir historial
            </button>
          ) : null}
        </section>
      ))}
    </div>
  );
}

function WorkspacePlaybookCard({ items, activatingVersionId, onActivate }) {
  return (
    <section className="configuration-card">
      <div className="configuration-card-heading">
        <div>
          <h4>Playbook comercial activo</h4>
          <p>
            El workspace de oportunidades ahora se construye desde la version
            activa persistida en base de datos.
          </p>
        </div>
      </div>

      <div className="configuration-playbook-list">
        {items.map((item) => (
          <article
            key={`${item.playbookId}:${item.versionId}`}
            className={`configuration-playbook-item ${item.isActive ? "is-active" : ""}`}
          >
            <div>
              <strong>
                {item.name} {item.version}
              </strong>
              <p>{item.description || "Sin descripción"}</p>
              <span>
                {item.stageCount} etapas | {item.criteriaCount} criterios
              </span>
            </div>
            <button
              type="button"
              className={item.isActive ? "btn-secondary" : "btn-primary"}
              disabled={item.isActive || activatingVersionId === item.versionId}
              onClick={() => onActivate(item.versionId)}
            >
              {item.isActive
                ? "Activo"
                : activatingVersionId === item.versionId
                  ? "Activando..."
                  : "Activar"}
            </button>
          </article>
        ))}
        {!items.length ? (
          <p className="field-hint">
            No hay versiones de playbook disponibles.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function WorkspacePlaybookEditor({
  playbook,
  savingKey,
  onSaveStage,
  onSaveCriterion,
}) {
  if (!playbook) {
    return (
      <section className="configuration-card">
        <div className="configuration-card-heading">
          <div>
            <h4>Edicion del playbook</h4>
            <p>No hay una version activa disponible para editar.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="configuration-card">
      <div className="configuration-card-heading">
        <div>
          <h4>Edicion del playbook activo</h4>
          <p>
            Ajusta objetivos y criterios que usa el workspace comercial para
            evaluar la oportunidad.
          </p>
        </div>
        <span className="configuration-inline-pill">
          {playbook.name} {playbook.version}
        </span>
      </div>

      <div className="configuration-playbook-stage-list">
        {playbook.stages.map((stage) => (
          <article
            key={stage.stageCode}
            className="configuration-playbook-stage-card"
          >
            <div className="configuration-playbook-stage-header">
              <div>
                <strong>{stage.stageName}</strong>
                <span>{stage.criteria.length} criterios</span>
              </div>
            </div>

            <form
              className="configuration-playbook-stage-form"
              onSubmit={(event) => {
                event.preventDefault();
                const formData = new FormData(event.currentTarget);
                onSaveStage({
                  versionId: playbook.versionId,
                  salesStageCode: stage.stageCode,
                  objective: String(formData.get("objective") || "").trim(),
                  exitCriteriaSummary: String(
                    formData.get("exitCriteriaSummary") || "",
                  ).trim(),
                });
              }}
            >
              <div className="field-group">
                <label>Objetivo</label>
                <textarea
                  name="objective"
                  rows="3"
                  defaultValue={stage.objective}
                />
              </div>
              <div className="field-group">
                <label>Criterio de salida</label>
                <textarea
                  name="exitCriteriaSummary"
                  rows="3"
                  defaultValue={stage.exitCriteriaSummary}
                />
              </div>
              <div className="configuration-playbook-actions-row">
                <button
                  type="submit"
                  className="btn-secondary"
                  disabled={savingKey === `stage:${stage.stageCode}`}
                >
                  {savingKey === `stage:${stage.stageCode}`
                    ? "Guardando..."
                    : "Guardar etapa"}
                </button>
              </div>
            </form>

            <div className="configuration-playbook-criteria-list">
              {stage.criteria.map((criterion) => (
                <form
                  key={criterion.criterionCode}
                  className="configuration-playbook-criterion-card"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const formData = new FormData(event.currentTarget);
                    onSaveCriterion({
                      versionId: playbook.versionId,
                      salesStageCode: stage.stageCode,
                      criterionCode: criterion.criterionCode,
                      title: String(formData.get("title") || "").trim(),
                      description: String(
                        formData.get("description") || "",
                      ).trim(),
                      themeCode: String(formData.get("themeCode") || "").trim(),
                      displayOrder: Number(formData.get("displayOrder") || 1),
                    });
                  }}
                >
                  <div className="configuration-playbook-criterion-header">
                    <strong>{criterion.criterionCode}</strong>
                    <span>Tema: {criterion.themeCode || "sin tema"}</span>
                  </div>
                  <div className="field-group">
                    <label>Titulo</label>
                    <input name="title" defaultValue={criterion.title} />
                  </div>
                  <div className="field-group">
                    <label>Descripcion</label>
                    <textarea
                      name="description"
                      rows="2"
                      defaultValue={criterion.description}
                    />
                  </div>
                  <div className="configuration-playbook-criterion-grid">
                    <div className="field-group">
                      <label>Tema</label>
                      <input
                        name="themeCode"
                        defaultValue={criterion.themeCode}
                      />
                    </div>
                    <div className="field-group">
                      <label>Orden</label>
                      <input
                        name="displayOrder"
                        type="number"
                        min="1"
                        defaultValue={criterion.displayOrder}
                      />
                    </div>
                  </div>
                  <div className="configuration-playbook-actions-row">
                    <button
                      type="submit"
                      className="btn-secondary"
                      disabled={
                        savingKey ===
                        `criterion:${stage.stageCode}:${criterion.criterionCode}`
                      }
                    >
                      {savingKey ===
                      `criterion:${stage.stageCode}:${criterion.criterionCode}`
                        ? "Guardando..."
                        : "Guardar criterio"}
                    </button>
                  </div>
                </form>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function InlineFieldError({ message }) {
  if (!message) return null;
  return <p className="field-error-text">{message}</p>;
}

function getFieldClassName(message) {
  return message ? "field-input-error" : undefined;
}

function formatAuditAction(action) {
  const value = String(action || "")
    .replaceAll("_", " ")
    .trim();
  if (!value) return "Cambio registrado";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildAddressPreviewLines(form, countryName) {
  const lines = [];
  const addressLine1 = String(form.addressLine1 || "").trim();
  const addressLine2 = String(form.addressLine2 || "").trim();
  const locality = [form.city, form.stateRegion]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ");
  const localityLine = [
    locality,
    String(form.postalCode || "").trim()
      ? `CP ${String(form.postalCode || "").trim()}`
      : "",
  ]
    .filter(Boolean)
    .join(", ");

  if (addressLine1) lines.push(addressLine1);
  if (addressLine2) lines.push(addressLine2);
  if (localityLine) lines.push(localityLine);
  if (countryName) lines.push(countryName);

  return lines;
}

function formatCompletionLabel(completed, total) {
  if (!total) return "Sin datos";
  return `${completed} de ${total} completos`;
}

function formatCompletionPercent(completed, total) {
  if (!total) return 0;
  return Math.round((completed / total) * 100);
}

function ConfigurationAuditList({
  entries,
  formatDateTime,
  summarizeChangedFields,
}) {
  if (!entries.length) {
    return (
      <div className="configuration-placeholder-card">
        <h3>Sin movimientos recientes</h3>
        <p>
          Cuando se modifique la configuracion, el historial aparecera aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="configuration-audit-list">
      {entries.map((entry) => (
        <article key={entry.id} className="configuration-audit-item">
          <div className="configuration-audit-item-top">
            <strong>{formatDateTime(entry.created_at)}</strong>
            <span>
              {entry.performed_by_name || entry.performed_by_email || "Sistema"}
            </span>
          </div>
          <div className="configuration-audit-item-body">
            <span className="configuration-audit-action">
              {formatAuditAction(entry.action)}
            </span>
            <p>
              {entry.detail || summarizeChangedFields(entry.changed_fields)}
            </p>
          </div>
        </article>
      ))}
    </div>
  );
}

function ProposalContentConfigurationPanel({
  config,
  loadError,
  componentDefinitions,
  assets,
  savingProposalContent,
  assetActionKey,
  latestUpdateText,
  onSaveComponent,
  onCreateComponent,
  onReorderComponents,
  onArchiveComponent,
  onRestoreComponent,
  onDeleteComponent,
  onCreateAsset,
  onAddAssetVersion,
  onArchiveAsset,
}) {
  const orderedComponents = useMemo(() => {
    if (Array.isArray(config?.components) && config.components.length > 0) {
      return [...config.components].sort(
        (left, right) => left.displayOrder - right.displayOrder,
      );
    }
    return Array.isArray(componentDefinitions)
      ? [...componentDefinitions].sort(
          (left, right) => left.displayOrder - right.displayOrder,
        )
      : [];
  }, [componentDefinitions, config]);

  const [selectedComponentCode, setSelectedComponentCode] = useState("");
  const [editorTitle, setEditorTitle] = useState("");
  const [editorBlocks, setEditorBlocks] = useState([]);
  const [editorIsVisible, setEditorIsVisible] = useState(true);
  const [editorAiEnabled, setEditorAiEnabled] = useState(false);
  const [editorAiMode, setEditorAiMode] = useState("auto");
  const [layoutDraft, setLayoutDraft] = useState(createProposalLayoutDraft());
  const [newComponentDraft, setNewComponentDraft] = useState({
    title: "",
  });
  const [assetDraft, setAssetDraft] = useState({
    name: "",
    category: "institutional",
    description: "",
    altText: "",
    caption: "",
    fileUrl: "",
    fileName: "",
    mimeType: "",
    fileSizeBytes: null,
  });
  const [assetCreateAttempted, setAssetCreateAttempted] = useState(false);
  const [assetListFilter, setAssetListFilter] = useState("all");

  useEffect(() => {
    if (!selectedComponentCode && orderedComponents[0]?.componentCode) {
      queueMicrotask(() => {
        setSelectedComponentCode(orderedComponents[0].componentCode);
      });
    }
  }, [orderedComponents, selectedComponentCode]);

  const selectedComponent = useMemo(
    () =>
      orderedComponents.find(
        (component) => component.componentCode === selectedComponentCode,
      ) ||
      orderedComponents[0] ||
      null,
    [orderedComponents, selectedComponentCode],
  );

  const selectedComponentIndex = useMemo(
    () =>
      orderedComponents.findIndex(
        (component) =>
          component.componentCode === selectedComponent?.componentCode,
      ),
    [orderedComponents, selectedComponent],
  );

  const completedComponentsCount = useMemo(
    () =>
      orderedComponents.filter(
        (component) =>
          Array.isArray(component.blocks) && component.blocks.length,
      ).length,
    [orderedComponents],
  );

  const activeAssets = useMemo(
    () => assets.filter((asset) => asset.status === "active"),
    [assets],
  );

  const visibleAssets = useMemo(() => {
    if (assetListFilter === "active") {
      return assets.filter((asset) => asset.status === "active");
    }
    if (assetListFilter === "archived") {
      return assets.filter((asset) => asset.status === "archived");
    }
    return assets;
  }, [assets, assetListFilter]);

  const invalidPlaceholderByBlock = useMemo(
    () =>
      editorBlocks.map((block) =>
        getProposalBlockInvalidPlaceholderTokens(block),
      ),
    [editorBlocks],
  );

  const invalidPlaceholderTokens = useMemo(
    () => [...new Set(invalidPlaceholderByBlock.flat())],
    [invalidPlaceholderByBlock],
  );

  const hasInvalidPlaceholders = invalidPlaceholderTokens.length > 0;

  const canCreateImage = Boolean(
    assetDraft.name && assetDraft.fileUrl && assetActionKey !== "create",
  );
  const assetCreateError = useMemo(() => {
    if (!assetCreateAttempted || canCreateImage) return "";
    if (!assetDraft.name && !assetDraft.fileUrl) {
      return "Captura un nombre y carga una imagen antes de crearla.";
    }
    if (!assetDraft.name) {
      return "Captura un nombre para la imagen antes de crearla.";
    }
    return "Carga una imagen antes de crearla.";
  }, [
    assetCreateAttempted,
    canCreateImage,
    assetDraft.name,
    assetDraft.fileUrl,
  ]);

  const availableQuickTemplates = useMemo(
    () =>
      PROPOSAL_SECTION_QUICK_TEMPLATES[selectedComponent?.componentCode] || [],
    [selectedComponent],
  );

  const compatibleImageBlocks = useMemo(
    () =>
      editorBlocks.filter((block) => isProposalManualRowCompatibleBlock(block)),
    [editorBlocks],
  );

  const manualRowAssignments = useMemo(() => {
    const assignments = new Map();
    (Array.isArray(layoutDraft.manualRows)
      ? layoutDraft.manualRows
      : []
    ).forEach((row, rowIndex) => {
      (Array.isArray(row?.items) ? row.items : []).forEach((item) => {
        assignments.set(item.blockKey, rowIndex);
      });
    });
    return assignments;
  }, [layoutDraft.manualRows]);

  const availableManualRowBlocks = useMemo(
    () =>
      compatibleImageBlocks.filter(
        (block) => !manualRowAssignments.has(block.blockKey),
      ),
    [compatibleImageBlocks, manualRowAssignments],
  );

  const manualRowsWithBlocks = useMemo(
    () =>
      (Array.isArray(layoutDraft.manualRows) ? layoutDraft.manualRows : []).map(
        (row, rowIndex) => ({
          ...row,
          label: getProposalManualRowLabel(rowIndex),
          blocks: (Array.isArray(row?.items) ? row.items : [])
            .map((item) =>
              editorBlocks.find((block) => block.blockKey === item.blockKey),
            )
            .filter(Boolean),
        }),
      ),
    [editorBlocks, layoutDraft.manualRows],
  );

  const layoutHelpText = useMemo(() => {
    if (layoutDraft.mode === "horizontal-gallery") {
      return "Las imagenes compatibles se agrupan automaticamente en una galeria horizontal y el resto del contenido conserva su orden arriba o abajo.";
    }
    if (layoutDraft.mode === "manual-rows") {
      return "Elige exactamente que imagenes comparten fila. Los bloques no asignados seguiran en vertical.";
    }
    return "Todos los bloques se muestran uno debajo de otro.";
  }, [layoutDraft.mode]);

  const manualRowsValidationMessage = useMemo(() => {
    if (layoutDraft.mode !== "manual-rows") {
      return "";
    }
    if (!compatibleImageBlocks.length) {
      return "Necesitas al menos una imagen compatible para usar filas manuales.";
    }
    if (!manualRowsWithBlocks.length) {
      return "Agrega al menos una fila horizontal con una imagen asignada.";
    }
    return "";
  }, [
    compatibleImageBlocks.length,
    layoutDraft.mode,
    manualRowsWithBlocks.length,
  ]);

  function updateEditorBlocks(updater) {
    setEditorBlocks((current) => {
      const nextBlocks =
        typeof updater === "function" ? updater(current) : updater;
      setLayoutDraft((currentLayoutDraft) =>
        reconcileProposalLayoutDraftWithBlocks(currentLayoutDraft, nextBlocks),
      );
      return nextBlocks;
    });
  }

  useEffect(() => {
    if (!selectedComponent) return;
    const nextBlocks = Array.isArray(selectedComponent.blocks)
      ? selectedComponent.blocks.map((block, index) =>
          createProposalEditorBlock(block, index),
        )
      : [];
    queueMicrotask(() => {
      setEditorTitle(selectedComponent.title || "");
      setEditorIsVisible(
        selectedComponent.isVisible === undefined
          ? true
          : Boolean(selectedComponent.isVisible),
      );
      setEditorAiEnabled(Boolean(selectedComponent.aiEnabled));
      setEditorAiMode(selectedComponent.aiMode || "auto");
      setEditorBlocks(nextBlocks);
      setLayoutDraft(
        buildProposalLayoutDraftFromComponent(selectedComponent, nextBlocks),
      );
    });
  }, [selectedComponent]);

  const editorAiHelpText = useMemo(() => {
    if (!editorAiEnabled) {
      return "Si no usa IA, el ingreso de informacion en esta seccion sera manual.";
    }
    if (selectedComponent?.componentKind === "custom") {
      return editorAiMode === "manual"
        ? "La IA generara sugerencias genericas usando las fuentes que el usuario seleccione manualmente."
        : "La IA generara sugerencias automaticas con una redaccion comercial generica para esta seccion.";
    }
    return editorAiMode === "manual"
      ? "La IA generara sugerencias para esta seccion usando las fuentes que el usuario seleccione manualmente."
      : "La IA generara sugerencias automaticas usando la logica propia de esta seccion.";
  }, [editorAiEnabled, editorAiMode, selectedComponent]);

  async function handleCreateAsset() {
    setAssetCreateAttempted(false);
    await onCreateAsset(assetDraft);
    setAssetDraft({
      name: "",
      category: "institutional",
      description: "",
      altText: "",
      caption: "",
      fileUrl: "",
      fileName: "",
      mimeType: "",
      fileSizeBytes: null,
    });
  }

  async function handleAssetFile(event, mode, assetId = null) {
    const file = event.target.files?.[0];
    if (!file) return;
    const fileUrl = await readLocalImage(file);
    const payload = {
      fileUrl,
      fileName: file.name,
      mimeType: file.type || "image/png",
      fileSizeBytes: file.size,
      altText: assetDraft.altText,
      caption: assetDraft.caption,
    };
    if (mode === "create") {
      setAssetDraft((current) => ({
        ...current,
        ...payload,
      }));
      return;
    }
    await onAddAssetVersion(assetId, payload);
    event.target.value = "";
  }

  function updateBlock(index, changes) {
    updateEditorBlocks((current) =>
      current.map((block, currentIndex) =>
        currentIndex === index ? { ...block, ...changes } : block,
      ),
    );
  }

  function handleSelectImageAsset(index, assetId) {
    const asset = assets.find((item) => Number(item.id) === Number(assetId));
    updateBlock(index, {
      assetId: asset?.id || null,
      assetVersionId: asset?.currentVersion?.id || null,
      image: asset?.currentVersion
        ? {
            assetId: asset.id,
            assetVersionId: asset.currentVersion.id,
            fileUrl: asset.currentVersion.fileUrl,
            altText: asset.currentVersion.altText,
            caption: asset.currentVersion.caption,
            fileName: asset.currentVersion.fileName,
            width: asset.currentVersion.width,
            height: asset.currentVersion.height,
          }
        : null,
    });
  }

  function goToComponent(componentCode) {
    setSelectedComponentCode(componentCode);
  }

  function goToRelativeComponent(offset) {
    if (!orderedComponents.length) return;
    const nextIndex = Math.min(
      Math.max(selectedComponentIndex + offset, 0),
      orderedComponents.length - 1,
    );
    goToComponent(orderedComponents[nextIndex].componentCode);
  }

  function applyQuickTemplate(template) {
    setEditorTitle(template.title || selectedComponent?.title || "");
    updateEditorBlocks(createProposalBlocksFromTemplate(template));
  }

  function handleLayoutModeChange(nextMode) {
    setLayoutDraft((current) => ({
      ...current,
      mode: normalizeProposalLayoutMode(nextMode),
    }));
  }

  function handleAddManualRow() {
    setLayoutDraft((current) => ({
      ...current,
      manualRows: [...current.manualRows, createProposalManualRow()],
    }));
  }

  function handleRemoveManualRow(rowId) {
    setLayoutDraft((current) => ({
      ...current,
      manualRows: current.manualRows.filter((row) => row.rowId !== rowId),
    }));
  }

  function handleAssignBlockToManualRow(blockKey, rowId) {
    setLayoutDraft((current) => ({
      ...current,
      manualRows: current.manualRows
        .map((row) => ({
          ...row,
          items: row.items.filter((item) => item.blockKey !== blockKey),
        }))
        .map((row) =>
          row.rowId === rowId
            ? {
                ...row,
                items: [...row.items, { blockKey }],
              }
            : row,
        )
        .filter((row) => row.items.length > 0),
    }));
  }

  function handleAssignBlockToNewManualRow(blockKey) {
    setLayoutDraft((current) => ({
      ...current,
      manualRows: [
        ...current.manualRows
          .map((row) => ({
            ...row,
            items: row.items.filter((item) => item.blockKey !== blockKey),
          }))
          .filter((row) => row.items.length > 0),
        createProposalManualRow([blockKey]),
      ],
    }));
  }

  function handleRemoveBlockFromManualRow(rowId, blockKey) {
    setLayoutDraft((current) => ({
      ...current,
      manualRows: current.manualRows
        .map((row) =>
          row.rowId === rowId
            ? {
                ...row,
                items: row.items.filter((item) => item.blockKey !== blockKey),
              }
            : row,
        )
        .filter((row) => row.items.length > 0),
    }));
  }

  function handleMoveManualRowBlock(rowId, blockKey, offset) {
    setLayoutDraft((current) => ({
      ...current,
      manualRows: current.manualRows.map((row) => {
        if (row.rowId !== rowId) {
          return row;
        }

        const currentIndex = row.items.findIndex(
          (item) => item.blockKey === blockKey,
        );
        const targetIndex = currentIndex + offset;
        if (
          currentIndex < 0 ||
          targetIndex < 0 ||
          targetIndex >= row.items.length
        ) {
          return row;
        }

        const nextItems = [...row.items];
        [nextItems[currentIndex], nextItems[targetIndex]] = [
          nextItems[targetIndex],
          nextItems[currentIndex],
        ];
        return {
          ...row,
          items: nextItems,
        };
      }),
    }));
  }

  async function handleSaveComponent() {
    if (!selectedComponent) return false;
    if (hasInvalidPlaceholders) return false;
    if (manualRowsValidationMessage) return false;
    const payload = {
      title: editorTitle,
      componentKind: selectedComponent.componentKind || "custom",
      isVisible: editorIsVisible,
      aiEnabled: editorAiEnabled,
      aiMode: editorAiEnabled ? editorAiMode || "auto" : null,
      layoutConfig: buildProposalLayoutConfigPayload(layoutDraft, editorBlocks),
      blocks: editorBlocks.map((block) => ({
        type: block.type,
        text: block.text,
        items: Array.isArray(block.items) ? block.items.filter(Boolean) : [],
        assetId: block.assetId,
        assetVersionId: block.assetVersionId,
      })),
    };
    await onSaveComponent(selectedComponent.componentCode, payload);
    return true;
  }

  async function handleSaveAndContinue() {
    const saved = await handleSaveComponent();
    if (saved && selectedComponentIndex < orderedComponents.length - 1) {
      goToRelativeComponent(1);
    }
  }

  async function handleCreateComponent() {
    const title = String(newComponentDraft.title || "").trim();
    if (!title) return;
    const createdComponent = await onCreateComponent({
      title,
      componentKind: "custom",
      isVisible: true,
      aiEnabled: false,
      aiMode: null,
      blocks: [],
      layoutConfig: null,
    });
    setNewComponentDraft({ title: "" });
    if (createdComponent?.componentCode) {
      setSelectedComponentCode(createdComponent.componentCode);
    }
  }

  async function handleMoveComponent(offset) {
    if (!selectedComponent) return;
    const currentIndex = orderedComponents.findIndex(
      (component) =>
        component.componentCode === selectedComponent.componentCode,
    );
    const targetIndex = currentIndex + offset;
    if (
      currentIndex < 0 ||
      targetIndex < 0 ||
      targetIndex >= orderedComponents.length
    ) {
      return;
    }
    const nextOrderedCodes = orderedComponents.map(
      (component) => component.componentCode,
    );
    [nextOrderedCodes[currentIndex], nextOrderedCodes[targetIndex]] = [
      nextOrderedCodes[targetIndex],
      nextOrderedCodes[currentIndex],
    ];
    await onReorderComponents(nextOrderedCodes);
    setSelectedComponentCode(selectedComponent.componentCode);
  }

  async function handleArchiveCurrentComponent() {
    if (!selectedComponent) return;
    await onArchiveComponent(selectedComponent.componentCode);
  }

  async function handleRestoreCurrentComponent() {
    if (!selectedComponent) return;
    await onRestoreComponent(selectedComponent.componentCode);
  }

  async function handleDeleteCurrentComponent() {
    if (!selectedComponent || selectedComponent.componentKind !== "custom") {
      return;
    }
    const confirmed = window.confirm(
      `Se eliminara la seccion ${selectedComponent.title}. Esta accion no se puede deshacer.`,
    );
    if (!confirmed) return;
    await onDeleteComponent(selectedComponent.componentCode);
    const fallbackCode = orderedComponents.find(
      (component) =>
        component.componentCode !== selectedComponent.componentCode,
    )?.componentCode;
    setSelectedComponentCode(fallbackCode || "");
  }

  return (
    <div className="configuration-section-stack">
      <section className="configuration-card">
        <div className="configuration-card-heading">
          <div>
            <h4>Contenido institucional de propuestas</h4>

            {loadError ? (
              <article className="configuration-proposal-empty-state">
                <strong>No fue posible cargar la estructura actual</strong>
                <p>{loadError}</p>
              </article>
            ) : null}
            <p>
              Define la estructura editable de la propuesta, su orden,
              visibilidad y que secciones pueden usar sugerencias IA.
            </p>
          </div>
          <div className="configuration-inline-actions">
            <button
              type="button"
              className="btn-secondary"
              disabled={savingProposalContent}
              onClick={async () => {
                const title = window.prompt("Titulo de la nueva seccion");
                if (!title) return;
                const createdComponent = await onCreateComponent({
                  title,
                  componentKind: "custom",
                  isVisible: true,
                  aiEnabled: false,
                  aiCapabilityKey: null,
                  blocks: [],
                  layoutConfig: null,
                });
                if (createdComponent?.componentCode) {
                  setSelectedComponentCode(createdComponent.componentCode);
                }
              }}
            >
              Agregar seccion
            </button>
            <span className="configuration-inline-pill">
              {latestUpdateText}
            </span>
          </div>
        </div>

        <div className="configuration-proposal-intro">
          <div className="configuration-proposal-metrics">
            <article className="configuration-proposal-metric-card">
              <strong>{completedComponentsCount}</strong>
              <span>secciones con contenido</span>
            </article>
            <article className="configuration-proposal-metric-card">
              <strong>
                {
                  orderedComponents.filter(
                    (component) => component.status === "archived",
                  ).length
                }
              </strong>
              <span>secciones archivadas</span>
            </article>
            <article className="configuration-proposal-metric-card">
              <strong>{activeAssets.length}</strong>
              <span>assets activos</span>
            </article>
          </div>

          <div className="configuration-proposal-steps">
            <article className="configuration-proposal-step-card">
              <strong>1. Disena la estructura</strong>
              <p>
                Puedes agregar, mover, ocultar o archivar secciones sin tocar
                propuestas ya creadas.
              </p>
            </article>
            <article className="configuration-proposal-step-card">
              <strong>2. Define IA por seccion</strong>
              <p>
                Decide si cada seccion usa IA y, si la activa, si opera en modo
                automatico o manual.
              </p>
            </article>
            <article className="configuration-proposal-step-card">
              <strong>3. Edita contenido base</strong>
              <p>
                Cada seccion sigue teniendo bloques editables para sembrar el
                contenido de nuevas propuestas.
              </p>
            </article>
          </div>
        </div>

        <div className="configuration-card configuration-card-subtle configuration-new-section-card">
          <div className="configuration-form-grid configuration-new-section-form">
            <label className="field-group">
              <span>Nueva seccion</span>
              <input
                type="text"
                value={newComponentDraft.title}
                onChange={(event) =>
                  setNewComponentDraft((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                placeholder="Ej. Casos de exito"
              />
            </label>
            <div className="configuration-inline-actions">
              <button
                type="button"
                className="btn-primary"
                disabled={
                  savingProposalContent ||
                  !String(newComponentDraft.title || "").trim()
                }
                onClick={() => {
                  void handleCreateComponent();
                }}
              >
                Crear seccion
              </button>
            </div>
          </div>
        </div>

        <div className="configuration-proposal-wizard">
          <div className="configuration-proposal-wizard-progress">
            {orderedComponents.map((component, index) => {
              const isActive =
                component.componentCode === selectedComponent?.componentCode;
              const isComplete = Array.isArray(component.blocks)
                ? component.blocks.length > 0
                : false;

              return (
                <button
                  key={component.componentCode}
                  type="button"
                  className={
                    isActive
                      ? "configuration-proposal-step-chip is-active"
                      : isComplete
                        ? "configuration-proposal-step-chip is-complete"
                        : "configuration-proposal-step-chip"
                  }
                  onClick={() => goToComponent(component.componentCode)}
                >
                  <span>{`Paso ${index + 1}`}</span>
                  <strong>{component.title}</strong>
                  <small>
                    {component.componentKind === "custom"
                      ? "Custom"
                      : "Sistema"}
                    {component.status === "archived" ? " · Archivada" : ""}
                    {component.aiEnabled
                      ? component.aiMode === "manual"
                        ? " · IA manual"
                        : " · IA automatica"
                      : " · Manual"}
                  </small>
                </button>
              );
            })}
          </div>

          <div className="configuration-proposal-editor configuration-proposal-editor-shell">
            {selectedComponent ? (
              <>
                <div className="configuration-proposal-wizard-header">
                  <div>
                    <span className="configuration-status-pill">
                      {`Seccion ${selectedComponentIndex + 1} de ${orderedComponents.length}`}
                    </span>
                    <h5>{selectedComponent.title}</h5>
                    <p>
                      Ajusta metadata, contenido base y orden de esta seccion.
                    </p>
                  </div>
                  <div className="configuration-inline-actions">
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={
                        selectedComponentIndex <= 0 || savingProposalContent
                      }
                      onClick={() => {
                        void handleMoveComponent(-1);
                      }}
                    >
                      Subir
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={
                        selectedComponentIndex >=
                          orderedComponents.length - 1 || savingProposalContent
                      }
                      onClick={() => {
                        void handleMoveComponent(1);
                      }}
                    >
                      Bajar
                    </button>
                    {selectedComponent.status === "archived" ? (
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={savingProposalContent}
                        onClick={() => {
                          void handleRestoreCurrentComponent();
                        }}
                      >
                        Restaurar
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={savingProposalContent}
                        onClick={() => {
                          void handleArchiveCurrentComponent();
                        }}
                      >
                        Archivar
                      </button>
                    )}
                    {selectedComponent.componentKind === "custom" ? (
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={savingProposalContent}
                        onClick={() => {
                          void handleDeleteCurrentComponent();
                        }}
                      >
                        Eliminar
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="configuration-step-icon-button"
                      disabled={selectedComponentIndex <= 0}
                      onClick={() => goToRelativeComponent(-1)}
                      aria-label="Anterior"
                      title="Anterior"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        focusable="false"
                        aria-hidden="true"
                      >
                        <path d="M14.78 6.47a.75.75 0 0 1 0 1.06L11.31 11l3.47 3.47a.75.75 0 1 1-1.06 1.06l-4-4a.75.75 0 0 1 0-1.06l4-4a.75.75 0 0 1 1.06 0Z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="configuration-step-icon-button"
                      disabled={
                        selectedComponentIndex >= orderedComponents.length - 1
                      }
                      onClick={() => goToRelativeComponent(1)}
                      aria-label="Siguiente"
                      title="Siguiente"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        focusable="false"
                        aria-hidden="true"
                      >
                        <path d="M9.22 6.47a.75.75 0 0 1 1.06 0l4 4a.75.75 0 0 1 0 1.06l-4 4a.75.75 0 1 1-1.06-1.06L12.69 11 9.22 7.53a.75.75 0 0 1 0-1.06Z" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="configuration-proposal-editor-header">
                  <div>
                    <strong>
                      Paso 1. Ajusta identidad y reglas de la seccion
                    </strong>
                    <p>
                      El titulo, visibilidad y modo de uso de IA se clonan a
                      propuestas nuevas.
                    </p>
                  </div>
                  <span className="configuration-inline-pill">
                    {editorBlocks.length} bloques en esta seccion
                  </span>
                </div>

                <label className="field-group">
                  <span>Titulo de la seccion</span>
                  <input
                    type="text"
                    value={editorTitle}
                    onChange={(event) => setEditorTitle(event.target.value)}
                  />
                </label>

                <div className="configuration-form-grid">
                  <label className="field-group">
                    <span>Tipo de seccion</span>
                    <input
                      type="text"
                      value={
                        selectedComponent.componentKind === "custom"
                          ? "Custom"
                          : "Sistema"
                      }
                      disabled
                    />
                  </label>
                  <label className="field-group">
                    <span>Visibilidad</span>
                    <select
                      value={editorIsVisible ? "visible" : "hidden"}
                      onChange={(event) =>
                        setEditorIsVisible(event.target.value === "visible")
                      }
                    >
                      <option value="visible">Visible</option>
                      <option value="hidden">
                        Oculta en nuevas propuestas
                      </option>
                    </select>
                  </label>
                  <label className="field-group">
                    <span>Usa IA</span>
                    <select
                      value={editorAiEnabled ? "yes" : "no"}
                      onChange={(event) => {
                        const enabled = event.target.value === "yes";
                        setEditorAiEnabled(enabled);
                        if (enabled && !editorAiMode) {
                          setEditorAiMode("auto");
                        }
                      }}
                    >
                      <option value="no">No</option>
                      <option value="yes">Si</option>
                    </select>
                  </label>
                  {editorAiEnabled ? (
                    <label className="field-group">
                      <span>Modo de sugerencia</span>
                      <select
                        value={editorAiMode}
                        onChange={(event) =>
                          setEditorAiMode(event.target.value)
                        }
                      >
                        <option value="auto">Automatico</option>
                        <option value="manual">Manual</option>
                      </select>
                    </label>
                  ) : null}
                </div>

                <p className="field-hint">{editorAiHelpText}</p>

                <div className="configuration-proposal-layout-panel">
                  <div className="configuration-proposal-editor-header">
                    <div>
                      <strong>Paso 2. Define la disposicion</strong>
                      <p>
                        Elige como se acomoda el contenido visual de esta
                        seccion.
                      </p>
                    </div>
                  </div>

                  <label className="field-group">
                    <span>Disposicion de la seccion</span>
                    <select
                      value={layoutDraft.mode}
                      onChange={(event) =>
                        handleLayoutModeChange(event.target.value)
                      }
                    >
                      {PROPOSAL_LAYOUT_MODE_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="configuration-proposal-layout-help">
                    <strong>Ayuda contextual</strong>
                    <p>{layoutHelpText}</p>
                  </div>

                  {layoutDraft.mode === "manual-rows" ? (
                    <div className="configuration-proposal-manual-layout">
                      <section className="configuration-proposal-manual-layout-panel">
                        <div className="configuration-subsection-heading">
                          <div>
                            <strong>Imagenes disponibles para filas</strong>
                            <p>
                              Solo se muestran imagenes compatibles no
                              asignadas.
                            </p>
                          </div>
                        </div>

                        {availableManualRowBlocks.length ? (
                          <div className="configuration-proposal-manual-layout-blocks">
                            {availableManualRowBlocks.map((block) => (
                              <article
                                key={block.blockKey}
                                className="configuration-proposal-manual-layout-card"
                              >
                                <div className="configuration-proposal-manual-layout-card-preview">
                                  {block.image?.fileUrl ? (
                                    <img
                                      src={block.image.fileUrl}
                                      alt={
                                        block.image.altText ||
                                        getProposalManualRowBlockLabel(block)
                                      }
                                    />
                                  ) : (
                                    <div className="configuration-logo-empty">
                                      Sin preview
                                    </div>
                                  )}
                                </div>
                                <div className="configuration-proposal-manual-layout-card-copy">
                                  <span className="configuration-proposal-block-badge">
                                    Imagen
                                  </span>
                                  <strong>
                                    {getProposalManualRowBlockLabel(block)}
                                  </strong>
                                </div>
                                <div className="configuration-proposal-manual-layout-card-actions">
                                  {manualRowsWithBlocks.map((row) => (
                                    <button
                                      key={`${row.rowId}-${block.blockKey}`}
                                      type="button"
                                      className="btn-secondary"
                                      onClick={() =>
                                        handleAssignBlockToManualRow(
                                          block.blockKey,
                                          row.rowId,
                                        )
                                      }
                                    >
                                      {`Mover a ${row.label.toLowerCase()}`}
                                    </button>
                                  ))}
                                  <button
                                    type="button"
                                    className="btn-secondary"
                                    onClick={() =>
                                      handleAssignBlockToNewManualRow(
                                        block.blockKey,
                                      )
                                    }
                                  >
                                    Mover a nueva fila
                                  </button>
                                </div>
                              </article>
                            ))}
                          </div>
                        ) : (
                          <p className="field-hint">
                            No hay imagenes disponibles para agrupar.
                          </p>
                        )}
                      </section>

                      <section className="configuration-proposal-manual-layout-panel">
                        <div className="configuration-subsection-heading">
                          <div>
                            <strong>Filas horizontales</strong>
                            <p>
                              Estas filas se renderizan en horizontal en la
                              propuesta.
                            </p>
                          </div>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={handleAddManualRow}
                          >
                            Agregar fila
                          </button>
                        </div>

                        {manualRowsWithBlocks.length ? (
                          <div className="configuration-proposal-manual-row-list">
                            {manualRowsWithBlocks.map((row, rowIndex) => (
                              <article
                                key={row.rowId}
                                className="configuration-proposal-manual-row-card"
                              >
                                <div className="configuration-proposal-manual-row-header">
                                  <strong>
                                    {getProposalManualRowLabel(rowIndex)}
                                  </strong>
                                  <button
                                    type="button"
                                    className="btn-secondary"
                                    onClick={() =>
                                      handleRemoveManualRow(row.rowId)
                                    }
                                  >
                                    Eliminar fila
                                  </button>
                                </div>

                                <div className="configuration-proposal-manual-row-items">
                                  {row.blocks.map((block, blockIndex) => (
                                    <article
                                      key={`${row.rowId}-${block.blockKey}`}
                                      className="configuration-proposal-manual-layout-card is-assigned"
                                    >
                                      <div className="configuration-proposal-manual-layout-card-preview">
                                        {block.image?.fileUrl ? (
                                          <img
                                            src={block.image.fileUrl}
                                            alt={
                                              block.image.altText ||
                                              getProposalManualRowBlockLabel(
                                                block,
                                              )
                                            }
                                          />
                                        ) : (
                                          <div className="configuration-logo-empty">
                                            Sin preview
                                          </div>
                                        )}
                                      </div>
                                      <div className="configuration-proposal-manual-layout-card-copy">
                                        <strong>
                                          {getProposalManualRowBlockLabel(
                                            block,
                                          )}
                                        </strong>
                                      </div>
                                      <div className="configuration-proposal-manual-layout-card-actions">
                                        <button
                                          type="button"
                                          className="btn-secondary"
                                          disabled={blockIndex <= 0}
                                          onClick={() =>
                                            handleMoveManualRowBlock(
                                              row.rowId,
                                              block.blockKey,
                                              -1,
                                            )
                                          }
                                        >
                                          Mover a la izquierda
                                        </button>
                                        <button
                                          type="button"
                                          className="btn-secondary"
                                          disabled={
                                            blockIndex >= row.blocks.length - 1
                                          }
                                          onClick={() =>
                                            handleMoveManualRowBlock(
                                              row.rowId,
                                              block.blockKey,
                                              1,
                                            )
                                          }
                                        >
                                          Mover a la derecha
                                        </button>
                                        <button
                                          type="button"
                                          className="btn-secondary"
                                          onClick={() =>
                                            handleRemoveBlockFromManualRow(
                                              row.rowId,
                                              block.blockKey,
                                            )
                                          }
                                        >
                                          Quitar
                                        </button>
                                      </div>
                                    </article>
                                  ))}
                                </div>
                              </article>
                            ))}
                          </div>
                        ) : (
                          <p className="field-hint">
                            Aun no hay filas manuales definidas.
                          </p>
                        )}

                        {manualRowsValidationMessage ? (
                          <p className="field-error-text">
                            {manualRowsValidationMessage}
                          </p>
                        ) : null}
                      </section>
                    </div>
                  ) : null}
                </div>

                <section className="configuration-proposal-variable-help">
                  <strong>Variables permitidas en bloques de texto</strong>
                  <p className="field-hint">
                    Estos placeholders se resuelven al previsualizar o generar
                    el PDF de la propuesta.
                  </p>
                  <ul className="configuration-bullet-list">
                    {PROPOSAL_TEMPLATE_VARIABLES.map(([token, description]) => (
                      <li key={token}>
                        <strong>{token}</strong>: {description}
                      </li>
                    ))}
                  </ul>
                </section>

                {availableQuickTemplates.length ? (
                  <div className="configuration-proposal-template-panel">
                    <div className="configuration-proposal-editor-header">
                      <div>
                        <strong>
                          Paso 2. Usa una plantilla rapida si quieres empezar
                          con una base
                        </strong>
                        <p>
                          Esto reemplaza el borrador actual de la seccion por un
                          texto inicial editable.
                        </p>
                      </div>
                    </div>
                    <div className="configuration-proposal-template-grid">
                      {availableQuickTemplates.map((template) => (
                        <article
                          key={template.id}
                          className="configuration-proposal-template-card"
                        >
                          <strong>{template.label}</strong>
                          <p>{template.description}</p>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => applyQuickTemplate(template)}
                          >
                            Usar plantilla
                          </button>
                        </article>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="configuration-proposal-editor-header">
                  <div>
                    <strong>
                      {availableQuickTemplates.length
                        ? "Paso 3. Ajusta o agrega bloques"
                        : "Paso 2. Agrega los bloques que necesita esta seccion"}
                    </strong>
                    <p>
                      Puedes mezclar texto e imagen. El orden en pantalla sera
                      el mismo orden de esta lista.
                    </p>
                  </div>
                </div>

                <div className="configuration-proposal-block-toolbar">
                  {PROPOSAL_BLOCK_TYPE_OPTIONS.map(([type, label]) => (
                    <button
                      key={type}
                      type="button"
                      className="configuration-block-add-icon-button"
                      onClick={() =>
                        updateEditorBlocks((current) => [
                          ...current,
                          createProposalEditorBlock(
                            createEmptyProposalBlock(type),
                            current.length,
                          ),
                        ])
                      }
                      aria-label={`Agregar ${label.toLowerCase()}`}
                      title={`Agregar ${label.toLowerCase()}`}
                    >
                      <ProposalBlockAddIcon type={type} />
                    </button>
                  ))}
                </div>

                <div className="configuration-proposal-block-list">
                  {!editorBlocks.length ? (
                    <article className="configuration-proposal-empty-state">
                      <strong>Esta seccion aun no tiene contenido</strong>
                      <p>
                        Agrega un encabezado o un parrafo para empezar. Si la
                        seccion requiere imagen, primero asegurate de tener un
                        asset creado en la biblioteca de abajo.
                      </p>
                    </article>
                  ) : null}

                  {editorBlocks.map((block, index) => (
                    <article
                      key={block.blockKey || `${block.type}-${index}`}
                      className="configuration-proposal-block-card"
                    >
                      <div className="configuration-proposal-block-head">
                        <div>
                          <div className="configuration-proposal-block-title-row">
                            <span className="configuration-proposal-block-index">
                              {index + 1}.
                            </span>
                            <span className="configuration-proposal-block-badge">
                              {getProposalBlockTypeLabel(block.type)}
                            </span>
                          </div>
                          <span className="field-hint">
                            {block.type === "heading"
                              ? "Texto breve para abrir o separar contenido"
                              : block.type === "paragraph"
                                ? "Parrafo libre para explicar contexto o narrativa"
                                : block.type === "list"
                                  ? "Un elemento por linea"
                                  : "Selecciona una imagen reutilizable desde la biblioteca institucional"}
                          </span>
                          {block.type === "image" &&
                          layoutDraft.mode === "manual-rows" ? (
                            <span className="field-hint">
                              {manualRowAssignments.has(block.blockKey)
                                ? `En ${getProposalManualRowLabel(manualRowAssignments.get(block.blockKey))}`
                                : "Sin fila horizontal"}
                            </span>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          className="configuration-block-remove-icon-button"
                          onClick={() =>
                            updateEditorBlocks((current) =>
                              current.filter(
                                (_, currentIndex) => currentIndex !== index,
                              ),
                            )
                          }
                          aria-label="Quitar bloque"
                          title="Quitar bloque"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            focusable="false"
                            aria-hidden="true"
                          >
                            <path
                              fill="currentColor"
                              d="M9.75 4.5a.75.75 0 0 1 .6-.3h3.3a.75.75 0 0 1 .6.3l.9 1.2h3.1a.75.75 0 0 1 0 1.5h-.57l-.78 10.13A2.25 2.25 0 0 1 13.66 19.5h-3.32a2.25 2.25 0 0 1-2.24-2.17L7.32 7.2h-.57a.75.75 0 0 1 0-1.5h3.1l.9-1.2Zm1.0 1.2h2.5l-.15-.2h-2.2l-.15.2Zm-1.15 1.5.74 9.99a.75.75 0 0 0 .75.71h3.32a.75.75 0 0 0 .75-.71l.74-9.99H9.6Zm1.65 2.05a.75.75 0 0 1 .75.75v5.2a.75.75 0 0 1-1.5 0V10a.75.75 0 0 1 .75-.75Zm3.0 0A.75.75 0 0 1 15 10v5.2a.75.75 0 0 1-1.5 0V10a.75.75 0 0 1 .75-.75Z"
                            />
                          </svg>
                        </button>
                      </div>

                      {block.type === "heading" ||
                      block.type === "paragraph" ? (
                        <>
                          <textarea
                            className={
                              invalidPlaceholderByBlock[index]?.length
                                ? "field-input-error"
                                : undefined
                            }
                            rows={
                              block.type === "heading"
                                ? 2
                                : selectedComponent.componentCode ===
                                    "document_rights"
                                  ? 16
                                  : 8
                            }
                            value={block.text}
                            onChange={(event) =>
                              updateBlock(index, { text: event.target.value })
                            }
                          />
                          <InlineFieldError
                            message={
                              invalidPlaceholderByBlock[index]?.length
                                ? `Variables no permitidas: ${invalidPlaceholderByBlock[index].join(", ")}`
                                : ""
                            }
                          />
                        </>
                      ) : null}

                      {block.type === "list" ? (
                        <>
                          <textarea
                            className={
                              invalidPlaceholderByBlock[index]?.length
                                ? "field-input-error"
                                : undefined
                            }
                            rows={5}
                            placeholder="Un item por linea"
                            value={(block.items || []).join("\n")}
                            onChange={(event) =>
                              updateBlock(index, {
                                items: event.target.value
                                  .split("\n")
                                  .map((value) => value.trim())
                                  .filter(Boolean),
                              })
                            }
                          />
                          <InlineFieldError
                            message={
                              invalidPlaceholderByBlock[index]?.length
                                ? `Variables no permitidas: ${invalidPlaceholderByBlock[index].join(", ")}`
                                : ""
                            }
                          />
                        </>
                      ) : null}

                      {block.type === "image" ? (
                        <div className="configuration-proposal-image-editor">
                          <select
                            value={block.assetId || ""}
                            onChange={(event) =>
                              handleSelectImageAsset(index, event.target.value)
                            }
                          >
                            <option value="">Selecciona un asset</option>
                            {activeAssets.map((asset) => (
                              <option key={asset.id} value={asset.id}>
                                {asset.name} · v
                                {asset.currentVersion?.versionNumber || 1}
                              </option>
                            ))}
                          </select>
                          {!activeAssets.length ? (
                            <p className="field-hint">
                              Todavia no hay assets activos. Crealos en la
                              biblioteca institucional de abajo y luego vuelve a
                              este bloque.
                            </p>
                          ) : (
                            <p className="field-hint">
                              La propuesta guardara una copia historica de la
                              version actual de la imagen.
                            </p>
                          )}
                          {block.image?.fileUrl ? (
                            <div className="configuration-proposal-image-preview">
                              <img
                                src={block.image.fileUrl}
                                alt={block.image.altText || editorTitle}
                              />
                              <span>
                                {block.image.caption ||
                                  block.image.fileName ||
                                  "Imagen seleccionada"}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>

                <div className="configuration-proposal-editor-actions configuration-proposal-wizard-actions">
                  <div className="configuration-inline-actions">
                    <button
                      type="button"
                      className="configuration-wizard-save-icon-button"
                      disabled={
                        savingProposalContent ||
                        !selectedComponent ||
                        hasInvalidPlaceholders ||
                        Boolean(manualRowsValidationMessage)
                      }
                      onClick={handleSaveComponent}
                      aria-label={
                        savingProposalContent
                          ? "Guardando seccion"
                          : "Guardar seccion"
                      }
                      title={
                        savingProposalContent
                          ? "Guardando seccion"
                          : "Guardar seccion"
                      }
                    >
                      <ProposalWizardActionIcon action="save" />
                    </button>
                    <button
                      type="button"
                      className="configuration-wizard-save-icon-button is-primary"
                      disabled={
                        savingProposalContent ||
                        !selectedComponent ||
                        hasInvalidPlaceholders ||
                        Boolean(manualRowsValidationMessage) ||
                        selectedComponentIndex >= orderedComponents.length - 1
                      }
                      onClick={handleSaveAndContinue}
                      aria-label={
                        savingProposalContent
                          ? "Guardando y continuando"
                          : "Guardar y seguir"
                      }
                      title={
                        savingProposalContent
                          ? "Guardando y continuando"
                          : "Guardar y seguir"
                      }
                    >
                      <ProposalWizardActionIcon action="save-next" />
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <p className="field-hint">
                Selecciona una seccion para editarla.
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="configuration-card">
        <div className="configuration-card-heading">
          <div>
            <h4>Biblioteca de imagenes</h4>
            <p>
              Administra las imagenes reutilizables que pueden insertarse en las
              propuestas comerciales.
            </p>
          </div>
          <span className="configuration-inline-pill">
            {assets.length} assets
          </span>
        </div>

        <section className="configuration-assets-subsection">
          <div className="configuration-subsection-heading">
            <div>
              <strong>Nueva imagen</strong>
              <p>
                Completa los datos y crea una imagen reutilizable para
                propuestas.
              </p>
            </div>
          </div>

          <div className="configuration-assets-form-grid">
            <input
              type="text"
              className={getFieldClassName(
                assetCreateError && !assetDraft.name,
              )}
              value={assetDraft.name}
              placeholder="Nombre de la imagen"
              onChange={(event) =>
                setAssetDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
            <select
              value={assetDraft.category}
              onChange={(event) =>
                setAssetDraft((current) => ({
                  ...current,
                  category: event.target.value,
                }))
              }
            >
              {PROPOSAL_ASSET_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {getProposalAssetCategoryLabel(category)}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={assetDraft.altText}
              placeholder="Texto alternativo"
              onChange={(event) =>
                setAssetDraft((current) => ({
                  ...current,
                  altText: event.target.value,
                }))
              }
            />
            <input
              type="text"
              value={assetDraft.caption}
              placeholder="Texto visible o pie de imagen"
              onChange={(event) =>
                setAssetDraft((current) => ({
                  ...current,
                  caption: event.target.value,
                }))
              }
            />
            <textarea
              rows={2}
              className="configuration-assets-form-span"
              value={assetDraft.description}
              placeholder="Descripción de la imagen"
              onChange={(event) =>
                setAssetDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
            <div className="configuration-assets-form-actions configuration-assets-form-span">
              <span className="field-hint">
                Primero carga una imagen, luego crea el asset para que aparezca
                en el selector de bloques.
              </span>
              <div className="configuration-assets-file-picker">
                <label
                  className={`configuration-asset-file-trigger${
                    assetCreateError && !assetDraft.fileUrl
                      ? " field-input-error"
                      : ""
                  }`}
                  htmlFor="create-asset-image-file"
                >
                  <SelectImageFileIcon />
                  <span>Seleccionar</span>
                </label>
                <input
                  id="create-asset-image-file"
                  type="file"
                  accept="image/*"
                  className="configuration-asset-file-input"
                  onChange={(event) => handleAssetFile(event, "create")}
                />
                <span className="configuration-assets-file-name">
                  {assetDraft.fileName || "Ningun archivo seleccionado"}
                </span>
              </div>
              <button
                type="button"
                className="configuration-create-image-icon-button"
                disabled={assetActionKey === "create"}
                onClick={() => {
                  if (!canCreateImage) {
                    setAssetCreateAttempted(true);
                    return;
                  }
                  handleCreateAsset();
                }}
                aria-label="Crear imagen"
                title="Crear imagen"
              >
                <CreateImageIcon />
              </button>
              <InlineFieldError message={assetCreateError} />
            </div>
          </div>
        </section>

        <section className="configuration-assets-subsection">
          <div className="configuration-subsection-heading">
            <div>
              <strong>Listado de imágenes</strong>
              <p>Consulta, filtra y desactiva las imágenes disponibles.</p>
            </div>
            <span className="configuration-inline-pill">
              {visibleAssets.length} imagenes
            </span>
          </div>

          <div className="configuration-assets-toolbar">
            <div
              className="configuration-assets-filter"
              role="group"
              aria-label="Filtro de imagenes"
            >
              {[
                ["all", "Todas"],
                ["active", "Activas"],
                ["archived", "Desactivadas"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={
                    assetListFilter === value
                      ? "configuration-assets-filter-badge is-active"
                      : "configuration-assets-filter-badge"
                  }
                  aria-pressed={assetListFilter === value}
                  onClick={() => setAssetListFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="configuration-assets-grid">
            {visibleAssets.map((asset) => (
              <article key={asset.id} className="configuration-asset-card">
                <div className="configuration-asset-preview">
                  {asset.currentVersion?.fileUrl ? (
                    <img
                      src={asset.currentVersion.fileUrl}
                      alt={asset.currentVersion.altText || asset.name}
                    />
                  ) : (
                    <div className="configuration-logo-empty">Sin preview</div>
                  )}
                </div>
                <div className="configuration-asset-copy">
                  <strong>{asset.name}</strong>
                  <span>{getProposalAssetCategoryLabel(asset.category)}</span>
                  <span>
                    Estado: {asset.status} · v
                    {asset.currentVersion?.versionNumber || 1}
                  </span>
                </div>
                <div className="configuration-asset-actions">
                  <button
                    type="button"
                    className="configuration-asset-deactivate-icon-button"
                    disabled={
                      asset.status === "archived" ||
                      assetActionKey === `archive:${asset.id}`
                    }
                    onClick={() => onArchiveAsset(asset.id)}
                    aria-label={
                      assetActionKey === `archive:${asset.id}`
                        ? "Desactivando imagen"
                        : "Desactivar imagen"
                    }
                    title={
                      assetActionKey === `archive:${asset.id}`
                        ? "Desactivando imagen"
                        : "Desactivar imagen"
                    }
                  >
                    <DeactivateImageIcon />
                  </button>
                  <label
                    className="configuration-asset-file-trigger"
                    htmlFor={`asset-version-file-${asset.id}`}
                  >
                    <SelectImageFileIcon />
                    <span>Seleccionar</span>
                  </label>
                  <input
                    id={`asset-version-file-${asset.id}`}
                    className="configuration-asset-file-input"
                    type="file"
                    accept="image/*"
                    onChange={(event) =>
                      handleAssetFile(event, "version", asset.id)
                    }
                  />
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>
    </div>
  );
}

function AiParametersConfigurationPanel({
  config,
  selectedCapabilityKey,
  draft,
  warnings,
  revisions,
  changeSummary,
  onChangeSummary,
  latestUpdateText,
  saving,
  publishing,
  validating,
  restoringKey,
  dirty,
  formatDateTime,
  onSelectCapability,
  onUpdateField,
  onUpdateParameter,
  onValidate,
  onSaveDraft,
  onPublish,
  onRestoreRevision,
}) {
  const parameters = draft?.parameters || {};
  const outputSchema = draft?.outputSchema || {};
  const capabilities = Array.isArray(config?.capabilities)
    ? config.capabilities
    : [];

  function toggleArrayValue(field, value, checked) {
    const currentValues = Array.isArray(parameters[field])
      ? parameters[field]
      : [];
    const nextValues = checked
      ? Array.from(new Set([...currentValues, value]))
      : currentValues.filter((item) => item !== value);
    onUpdateParameter(field, nextValues);
  }

  return (
    <div className="configuration-ai-grid">
      <section className="configuration-card configuration-ai-capabilities-card">
        <div className="configuration-card-heading">
          <div>
            <h4>Capacidades IA</h4>
            <p>Selecciona la capacidad que quieres editar y publicar.</p>
          </div>
          <span className="configuration-inline-pill">
            {config?.status === "draft" ? "Borrador" : "Publicado"}
          </span>
        </div>

        <div className="configuration-ai-capability-list">
          {capabilities.map((capability) => (
            <button
              key={capability.capabilityKey}
              type="button"
              className={`configuration-ai-capability-item ${
                capability.capabilityKey === selectedCapabilityKey
                  ? "is-active"
                  : ""
              }`}
              onClick={() => onSelectCapability(capability.capabilityKey)}
            >
              <strong>{capability.title}</strong>
              <span>{capability.description}</span>
            </button>
          ))}
        </div>

        <div className="configuration-ai-status-box">
          <strong>Ultimo movimiento</strong>
          <span>{latestUpdateText}</span>
          <span>
            Publicado:{" "}
            {config?.publishedAt
              ? formatDateTime(config.publishedAt)
              : "Sin publicacion"}
          </span>
        </div>
      </section>

      <div className="configuration-section-stack">
        <section className="configuration-card">
          <div className="configuration-card-heading">
            <div>
              <h4>Control operativo</h4>
              <p>Activa o ajusta el modelo y timeout de esta capacidad.</p>
            </div>
            {dirty ? (
              <span className="configuration-inline-pill">Sin publicar</span>
            ) : null}
          </div>

          <div className="configuration-form-grid">
            <div className="field-group">
              <label>Titulo funcional</label>
              <input
                type="text"
                value={draft.title}
                onChange={(event) => onUpdateField("title", event.target.value)}
              />
            </div>
            <div className="field-group">
              <label>Timeout (ms)</label>
              <input
                type="number"
                min="5000"
                step="1000"
                value={draft.timeoutMs}
                onChange={(event) =>
                  onUpdateField("timeoutMs", Number(event.target.value || 0))
                }
              />
            </div>
            <div className="field-group configuration-grid-span-full">
              <label>Descripcion</label>
              <textarea
                rows="2"
                value={draft.description}
                onChange={(event) =>
                  onUpdateField("description", event.target.value)
                }
              />
            </div>
            <div className="field-group">
              <label>Modelo override</label>
              <input
                type="text"
                value={draft.modelOverride}
                onChange={(event) =>
                  onUpdateField("modelOverride", event.target.value)
                }
                placeholder="Usa el modelo por defecto si lo dejas vacio"
              />
            </div>
            <div className="field-group configuration-toggle-field">
              <label>Capacidad habilitada</label>
              <button
                type="button"
                className={`configuration-toggle-chip ${draft.isEnabled ? "is-on" : ""}`}
                onClick={() => onUpdateField("isEnabled", !draft.isEnabled)}
              >
                {draft.isEnabled ? "Activa" : "Deshabilitada"}
              </button>
            </div>
          </div>
        </section>

        <section className="configuration-card">
          <h4>Prompt publicado</h4>
          <div className="configuration-form-grid">
            <div className="field-group configuration-grid-span-full">
              <label>System prompt</label>
              <textarea
                rows="10"
                value={draft.systemPrompt}
                onChange={(event) =>
                  onUpdateField("systemPrompt", event.target.value)
                }
              />
            </div>
            <div className="field-group configuration-grid-span-full">
              <label>Plantilla de mensaje usuario</label>
              <textarea
                rows="5"
                value={draft.userPromptTemplate}
                onChange={(event) =>
                  onUpdateField("userPromptTemplate", event.target.value)
                }
              />
              <p className="field-hint">
                Usa {"{{ context }}"} y {"{{ expectedShape }}"} para interpolar
                el contexto real.
              </p>
            </div>
          </div>
        </section>

        <section className="configuration-card">
          <h4>Shape de salida</h4>
          <div className="configuration-form-grid">
            <div className="field-group">
              <label>Campo title</label>
              <input
                type="text"
                value={String(outputSchema.title || "")}
                onChange={(event) =>
                  onUpdateField("outputSchema", {
                    ...outputSchema,
                    title: event.target.value,
                  })
                }
              />
            </div>
            <div className="field-group">
              <label>Item de paragraphs</label>
              <input
                type="text"
                value={String(outputSchema.paragraphs?.[0] || "")}
                onChange={(event) =>
                  onUpdateField("outputSchema", {
                    ...outputSchema,
                    paragraphs: [event.target.value],
                  })
                }
              />
            </div>
            <div className="field-group">
              <label>Item de warnings</label>
              <input
                type="text"
                value={String(outputSchema.warnings?.[0] || "")}
                onChange={(event) =>
                  onUpdateField("outputSchema", {
                    ...outputSchema,
                    warnings: [event.target.value],
                  })
                }
              />
            </div>
          </div>
        </section>

        <section className="configuration-card">
          <h4>Politicas funcionales</h4>
          <div className="configuration-form-grid">
            <div className="field-group">
              <label>Maximo de assets de biblioteca</label>
              <input
                type="number"
                min="1"
                max="8"
                value={parameters.maxLibraryAssets}
                onChange={(event) =>
                  onUpdateParameter(
                    "maxLibraryAssets",
                    Number(event.target.value || 0),
                  )
                }
              />
            </div>
            <div className="field-group">
              <label>Idioma por defecto</label>
              <input
                type="text"
                value={String(parameters.defaultLanguageCode || "")}
                onChange={(event) =>
                  onUpdateParameter("defaultLanguageCode", event.target.value)
                }
              />
            </div>
            <div className="field-group">
              <label>Audiencia objetivo</label>
              <input
                type="text"
                value={String(parameters.targetAudience || "")}
                onChange={(event) =>
                  onUpdateParameter("targetAudience", event.target.value)
                }
              />
            </div>
            <div className="field-group configuration-grid-span-full configuration-ai-toggle-group">
              <label>Flags operativas</label>
              <div className="configuration-ai-chip-row">
                <button
                  type="button"
                  className={`configuration-toggle-chip ${
                    parameters.allowInstructionsField ? "is-on" : ""
                  }`}
                  onClick={() =>
                    onUpdateParameter(
                      "allowInstructionsField",
                      !parameters.allowInstructionsField,
                    )
                  }
                >
                  Instrucciones libres
                </button>
                <button
                  type="button"
                  className={`configuration-toggle-chip ${
                    parameters.allowOverwrite ? "is-on" : ""
                  }`}
                  onClick={() =>
                    onUpdateParameter(
                      "allowOverwrite",
                      !parameters.allowOverwrite,
                    )
                  }
                >
                  Permitir overwrite
                </button>
              </div>
            </div>
            <div className="field-group">
              <label>Modos de biblioteca habilitados</label>
              <div className="configuration-ai-check-list">
                {[
                  ["source_text", "Texto fuente"],
                  ["summary_extract", "Summary + extract"],
                ].map(([value, label]) => (
                  <label key={value} className="configuration-ai-checkbox">
                    <input
                      type="checkbox"
                      checked={
                        Array.isArray(
                          parameters.supportedLibraryContentModes,
                        ) &&
                        parameters.supportedLibraryContentModes.includes(value)
                      }
                      onChange={(event) =>
                        toggleArrayValue(
                          "supportedLibraryContentModes",
                          value,
                          event.target.checked,
                        )
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="field-group">
              <label>Prioridades de fuente habilitadas</label>
              <div className="configuration-ai-check-list">
                {[
                  ["non_library_first", "Documentos primero"],
                  ["balanced", "Balanceado"],
                  ["library_first", "Biblioteca primero"],
                ].map(([value, label]) => (
                  <label key={value} className="configuration-ai-checkbox">
                    <input
                      type="checkbox"
                      checked={
                        Array.isArray(
                          parameters.supportedSourcePriorityModes,
                        ) &&
                        parameters.supportedSourcePriorityModes.includes(value)
                      }
                      onChange={(event) =>
                        toggleArrayValue(
                          "supportedSourcePriorityModes",
                          value,
                          event.target.checked,
                        )
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="field-group configuration-grid-span-full">
              <label>Resumen del cambio</label>
              <input
                type="text"
                value={changeSummary}
                onChange={(event) => onChangeSummary(event.target.value)}
                placeholder="Ej. Ajuste de tono comercial y timeout"
              />
            </div>
          </div>

          <div className="configuration-inline-actions configuration-ai-actions-row">
            <button
              type="button"
              className="btn-secondary"
              onClick={onValidate}
              disabled={validating}
            >
              {validating ? "Validando..." : "Validar"}
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={onSaveDraft}
              disabled={saving}
            >
              {saving ? "Guardando..." : "Guardar borrador"}
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={onPublish}
              disabled={publishing}
            >
              {publishing ? "Publicando..." : "Publicar"}
            </button>
          </div>
        </section>

        {warnings.length ? (
          <section className="configuration-card configuration-ai-warning-card">
            <h4>Advertencias de validacion</h4>
            <div className="configuration-ai-warning-list">
              {warnings.map((warning) => (
                <article key={`${warning.code}-${warning.field}`}>
                  <strong>{warning.field}</strong>
                  <p>{warning.message}</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <section className="configuration-card">
          <div className="configuration-card-heading">
            <div>
              <h4>Revisiones</h4>
              <p>Restaura una revision anterior como nuevo borrador.</p>
            </div>
          </div>

          <div className="configuration-ai-revision-list">
            {revisions.map((revision) => (
              <article
                key={revision.revisionNumber}
                className="configuration-ai-revision-item"
              >
                <div>
                  <strong>Revisión {revision.revisionNumber}</strong>
                  <span>
                    {formatDateTime(revision.createdAt)} por{" "}
                    {revision.createdByUserName || "sistema"}
                  </span>
                  <p>{revision.changeSummary || "Sin resumen"}</p>
                </div>
                <div className="configuration-inline-actions">
                  {revision.isPublished ? (
                    <span className="configuration-inline-pill">Publicada</span>
                  ) : null}
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => onRestoreRevision(revision.revisionNumber)}
                    disabled={
                      restoringKey ===
                      `${selectedCapabilityKey}:${revision.revisionNumber}`
                    }
                  >
                    {restoringKey ===
                    `${selectedCapabilityKey}:${revision.revisionNumber}`
                      ? "Restaurando..."
                      : "Restaurar"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export default function ConfigurationPage() {
  const {
    loading,
    saving,
    error,
    success,
    activeSection,
    countries,
    accountTypes,
    accountTypeDraft,
    accountTypeActionKey,
    economicSectors,
    economicSectorDraft,
    economicSectorActionKey,
    companyProfile,
    temporaryFeatureSettings,
    chatbotSettings,
    commercialSettings,
    form,
    auditEntries,
    workspacePlaybooks,
    workspacePlaybookDetail,
    activatingWorkspaceVersionId,
    savingWorkspacePlaybookKey,
    proposalContentConfig,
    proposalContentLoadError,
    proposalComponentDefinitions,
    institutionalAssets,
    aiParametersConfig,
    aiWalletSummaries,
    aiWalletSummariesLoading,
    aiWalletSummariesError,
    aiPricingRates,
    aiPricingRatesLoading,
    aiPricingRatesError,
    aiPricingActionKey,
    aiPricingSyncPreview,
    selectedAiWalletUserId,
    selectedAiWalletDetail,
    selectedAiWalletDetailLoading,
    aiWalletActionKey,
    selectedAiCapabilityKey,
    aiParameterDraft,
    aiParameterValidationWarnings,
    aiParameterRevisions,
    savingAiParameters,
    publishingAiParameters,
    validatingAiParameters,
    restoringAiParameterKey,
    savingProposalContent,
    publishingProposalContent,
    assetActionKey,
    fieldErrors,
    isDirty,
    canSave,
    savingTemporaryFeatures,
    savingChatbotSettings,
    savingCommercialSettings,
    temporaryFeaturesDirty,
    temporaryFeaturesCanSave,
    chatbotSettingsDirty,
    commercialSettingsDirty,
    aiParametersDirty,
    latestUpdateText,
    latestTemporaryFeaturesUpdateText,
    latestChatbotSettingsUpdateText,
    latestCommercialSettingsUpdateText,
    latestAiWalletUpdateText,
    latestAiPricingUpdateText,
    latestProposalContentUpdateText,
    latestAiParametersUpdateText,
    sectionItems,
    stageSlaEntries,
    stageWeightEntries,
    leadExecutionGuideEntries,
    campaignMatrixCatalogs,
    formatDateTime,
    summarizeChangedFields,
    updateField,
    updateAccountTypeDraft,
    updateEconomicSectorDraft,
    changeSection,
    discardChanges,
    handleLogoChange,
    saveCompanyProfile,
    updateTemporaryFeatureSetting,
    saveTemporaryFeatureSettings,
    updateChatbotSetting,
    saveChatbotSettings,
    updateCommercialSetting,
    updateCommercialBusinessTimezone,
    updateCommercialScreenDisplayMinutes,
    updateCommercialScreenRotationMinutes,
    updateCommercialWeightSetting,
    updateCommercialGuideSetting,
    updateCampaignMatrixRow,
    addCampaignMatrixRow,
    removeCampaignMatrixRow,
    saveCommercialSettings,
    createAccountType,
    renameAccountType,
    setAccountTypeStatus,
    createEconomicSector,
    renameEconomicSector,
    setEconomicSectorStatus,
    activateWorkspacePlaybook,
    updateWorkspacePlaybookStage,
    updateWorkspacePlaybookCriterion,
    updateAiParameterField,
    updateAiParameterParameter,
    selectAiCapability,
    validateAiParametersDraft,
    saveAiParametersDraft,
    publishAiParameters,
    restoreAiParameterRevision,
    selectAiWalletUser,
    grantAiWalletCredit,
    adjustAiWalletCredit,
    updateAiWalletPolicy,
    createAiPricingRate,
    closeAiPricingRate,
    syncAiPricingRates,
    saveProposalContentComponent,
    createProposalContentComponent,
    reorderProposalContent,
    archiveProposalContentComponent,
    restoreProposalContentComponent,
    deleteProposalContent,
    publishProposalContent,
    createProposalAsset,
    addProposalAssetVersion,
    archiveProposalAsset,
  } = useConfigurationPage();
  const [aiChangeSummary, setAiChangeSummary] = useState("");

  const activeSectionMeta = useMemo(
    () =>
      sectionItems.find((item) => item.id === activeSection) || sectionItems[0],
    [activeSection, sectionItems],
  );

  const countryName = useMemo(
    () =>
      countries.find((country) => String(country.id) === String(form.countryId))
        ?.name ||
      companyProfile?.countryName ||
      "",
    [companyProfile, countries, form.countryId],
  );

  const brandingLines = useMemo(
    () => buildAddressPreviewLines(form, countryName),
    [countryName, form],
  );

  const requiredFieldItems = useMemo(
    () => [
      {
        label: "Razon social",
        description: "Identidad legal usada en documentos y encabezados.",
        complete: Boolean(String(form.legalName || "").trim()),
      },
      {
        label: "Registro fiscal",
        description:
          "Identificador fiscal requerido para cotizaciones y referencias.",
        complete: Boolean(String(form.taxId || "").trim()),
      },
      {
        label: "Direccion principal",
        description:
          "Base del domicilio institucional que se imprime en documentos.",
        complete: Boolean(String(form.addressLine1 || "").trim()),
      },
      {
        label: "Ciudad y region",
        description: "Ubicacion administrativa completa de la empresa.",
        complete:
          Boolean(String(form.city || "").trim()) &&
          Boolean(String(form.stateRegion || "").trim()),
      },
      {
        label: "Pais",
        description: "Catalogo geografico de referencia para la sede.",
        complete: Boolean(String(form.countryId || "").trim()),
      },
      {
        label: "Codigo postal",
        description:
          "Se agrega al domicilio institucional y validaciones operativas.",
        complete: Boolean(String(form.postalCode || "").trim()),
      },
    ],
    [form],
  );

  const optionalFieldItems = useMemo(
    () => [
      {
        label: "Logo institucional",
        description: "Mejora la salida documental y refuerza el branding.",
        complete: Boolean(String(form.logoUrl || "").trim()),
      },
      {
        label: "Correo institucional",
        description:
          "Canal de contacto visible para clientes y equipos internos.",
        complete: Boolean(String(form.email || "").trim()),
      },
      {
        label: "Telefono institucional",
        description:
          "Referencia operativa visible en la documentacion emitida.",
        complete: Boolean(String(form.phone || "").trim()),
      },
      {
        label: "Sitio web",
        description: "Punto de referencia comercial complementario.",
        complete: Boolean(String(form.website || "").trim()),
      },
      {
        label: "Descripción institucional",
        description:
          "Contexto interno del perfil de empresa para administradores.",
        complete: Boolean(String(form.description || "").trim()),
      },
    ],
    [form],
  );

  const requiredCompleted = requiredFieldItems.filter(
    (item) => item.complete,
  ).length;
  const optionalCompleted = optionalFieldItems.filter(
    (item) => item.complete,
  ).length;

  const summaryItems = useMemo(
    () => [
      {
        label: "Nombre comercial",
        value: form.commercialName || "Sin definir",
      },
      { label: "Correo institucional", value: form.email || "Sin definir" },
      { label: "Telefono institucional", value: form.phone || "Sin definir" },
      { label: "Sitio web", value: form.website || "Sin definir" },
      { label: "Pais sede", value: countryName || "Sin definir" },
      { label: "Ultimo cambio", value: latestUpdateText },
    ],
    [
      countryName,
      form.commercialName,
      form.email,
      form.phone,
      form.website,
      latestUpdateText,
    ],
  );

  const latestAuditEntry = auditEntries[0] || null;
  const sortedAccountTypes = useMemo(() => {
    return [...accountTypes].sort((left, right) => {
      const activeCompare = Number(right?.isActive) - Number(left?.isActive);
      if (activeCompare !== 0) return activeCompare;
      return String(left?.name || "").localeCompare(
        String(right?.name || ""),
        "es",
        {
          sensitivity: "base",
        },
      );
    });
  }, [accountTypes]);

  const sortedEconomicSectors = useMemo(() => {
    return [...economicSectors].sort((left, right) => {
      const activeCompare = Number(right?.isActive) - Number(left?.isActive);
      if (activeCompare !== 0) return activeCompare;
      return String(left?.name || "").localeCompare(
        String(right?.name || ""),
        "es",
        {
          sensitivity: "base",
        },
      );
    });
  }, [economicSectors]);

  const moduleItems = useMemo(
    () => [
      {
        title: "Cotizaciones",
        description:
          "Las salidas PDF consultan el branding documental centralizado desde esta configuracion.",
        badge: brandingLines.length ? "Activo" : "Revisar",
        points: [
          `Razon social publicada: ${form.legalName || "Sin definir"}`,
          `Registro fiscal visible: ${form.taxId || "Sin definir"}`,
          `Lineas de domicilio listas: ${brandingLines.length}`,
        ],
      },
      {
        title: "Permisos y control",
        description:
          "La administracion del modulo esta protegida por permisos especificos de lectura y actualizacion.",
        badge: "Controlado",
        points: [
          "Lectura: configuracion.read",
          "Actualizacion: configuracion.update",
          "Los cambios sensibles quedan trazados en auditoria.",
        ],
      },
      {
        title: "Auditoria",
        description:
          "Cada ajuste institucional relevante deja rastro para revision posterior.",
        badge: `${auditEntries.length} eventos`,
        points: latestAuditEntry
          ? [
              `Ultima accion: ${formatAuditAction(latestAuditEntry.action)}`,
              `Responsable: ${
                latestAuditEntry.performed_by_name ||
                latestAuditEntry.performed_by_email ||
                "Sistema"
              }`,
              `Fecha: ${formatDateTime(latestAuditEntry.created_at)}`,
            ]
          : [
              "Sin eventos recientes registrados.",
              "El historial se actualiza al guardar cambios.",
              "Puedes revisar el detalle completo desde esta misma pantalla.",
            ],
        action: "audit",
      },
    ],
    [
      auditEntries.length,
      brandingLines.length,
      form.legalName,
      form.taxId,
      formatDateTime,
      latestAuditEntry,
    ],
  );

  const activeSectionUpdateText = useMemo(() => {
    if (activeSection === "ai_parameters") {
      return latestAiParametersUpdateText;
    }
    if (activeSection === "ai_budget") {
      return latestAiWalletUpdateText;
    }
    if (activeSection === "proposal_content") {
      return latestProposalContentUpdateText;
    }
    if (activeSection === "global") {
      return latestTemporaryFeaturesUpdateText;
    }
    return latestUpdateText;
  }, [
    activeSection,
    latestAiParametersUpdateText,
    latestAiWalletUpdateText,
    latestProposalContentUpdateText,
    latestTemporaryFeaturesUpdateText,
    latestUpdateText,
  ]);

  const activeSectionStatusText = useMemo(() => {
    if (activeSection === "ai_parameters") {
      return aiParametersConfig.status === "draft"
        ? "Borrador pendiente de publicar"
        : aiParametersConfig.publishedAt
          ? `Publicado ${formatDateTime(aiParametersConfig.publishedAt)}`
          : "Sin publicacion";
    }
    if (activeSection === "ai_budget") {
      return aiWalletSummariesLoading
        ? "Cargando creditos..."
        : `${aiWalletSummaries.length} usuarios con wallet`;
    }
    if (
      activeSection === "proposal_content" &&
      proposalContentConfig.updatedAt
    ) {
      return `Vigente desde ${formatDateTime(proposalContentConfig.updatedAt)}`;
    }
    return companyProfile?.updatedAt
      ? `Vigente desde ${formatDateTime(companyProfile.updatedAt)}`
      : "";
  }, [
    activeSection,
    aiParametersConfig,
    companyProfile,
    formatDateTime,
    aiWalletSummariesLoading,
    aiWalletSummaries.length,
    proposalContentConfig.updatedAt,
  ]);

  if (loading) {
    return <div className="centered">Cargando configuracion...</div>;
  }

  return (
    <section className="panel configuration-page">
      <header className="configuration-header">
        <div>
          <div className="module-title-with-icon">
            <h2>Configuracion</h2>
            <span
              className="module-title-icon configuration-title-icon"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M10.34 2.88a1 1 0 0 1 1.32-.61l.95.38a1 1 0 0 0 .74 0l.95-.38a1 1 0 0 1 1.32.61l.42.93a1 1 0 0 0 .57.52l.98.33a1 1 0 0 1 .67 1.28l-.31 1a1 1 0 0 0 .11.77l.57.88a1 1 0 0 1-.17 1.43l-.8.67a1 1 0 0 0-.33.71l-.05 1.05a1 1 0 0 1-.95.95l-1.05.05a1 1 0 0 0-.71.33l-.67.8a1 1 0 0 1-1.43.17l-.88-.57a1 1 0 0 0-.77-.11l-1 .31a1 1 0 0 1-1.28-.67l-.33-.98a1 1 0 0 0-.52-.57l-.93-.42a1 1 0 0 1-.61-1.32l.38-.95a1 1 0 0 0 0-.74l-.38-.95a1 1 0 0 1 .61-1.32l.93-.42a1 1 0 0 0 .52-.57z" />
                <path d="M12 9.25A2.75 2.75 0 1 0 12 14.75A2.75 2.75 0 1 0 12 9.25z" />
              </svg>
            </span>
          </div>
          <p className="roles-subtitle">
            Administra los datos institucionales y parametros globales de la
            aplicacion.
          </p>
          <p className="field-hint">
            Ultima actualizacion: {activeSectionUpdateText}
          </p>
        </div>

        <div className="configuration-header-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => changeSection("audit")}
          >
            Ver auditoria
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={
              activeSection === "company"
                ? !isDirty || saving
                : activeSection === "ai_parameters"
                  ? !aiParametersDirty || savingAiParameters
                  : false
            }
            onClick={discardChanges}
          >
            Descartar cambios
          </button>
          {activeSection === "company" ? (
            <button
              type="button"
              className="btn-primary"
              disabled={saving || !canSave}
              onClick={saveCompanyProfile}
            >
              {saving ? "Guardando..." : "Guardar cambios"}
            </button>
          ) : null}
          {activeSection === "ai_parameters" ? (
            <>
              <button
                type="button"
                className="btn-secondary"
                disabled={validatingAiParameters}
                onClick={() => {
                  void validateAiParametersDraft();
                }}
              >
                {validatingAiParameters ? "Validando..." : "Validar"}
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={savingAiParameters}
                onClick={() => {
                  void saveAiParametersDraft(aiChangeSummary).then(() => {
                    setAiChangeSummary("");
                  });
                }}
              >
                {savingAiParameters ? "Guardando..." : "Guardar borrador"}
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={publishingAiParameters}
                onClick={() => {
                  void publishAiParameters();
                }}
              >
                {publishingAiParameters ? "Publicando..." : "Publicar"}
              </button>
            </>
          ) : null}
          {activeSection === "proposal_content" ? (
            <button
              type="button"
              className="btn-primary"
              disabled={publishingProposalContent}
              onClick={() => {
                void publishProposalContent();
              }}
            >
              {publishingProposalContent ? "Publicando..." : "Publicar"}
            </button>
          ) : null}
        </div>
      </header>

      <div className="configuration-layout">
        <aside className="configuration-sidebar">
          <div className="configuration-sidebar-title">
            Configuracion general
          </div>
          {sectionItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`configuration-nav-item ${item.id === activeSection ? "is-active" : ""}`}
              onClick={() => changeSection(item.id)}
            >
              <div>
                <strong>{item.title}</strong>
                <span>{item.description}</span>
              </div>
              {item.dirty ? <span className="configuration-nav-dot" /> : null}
            </button>
          ))}
        </aside>

        <div className="configuration-content">
          <header className="configuration-section-header">
            <div>
              <h3>{activeSectionMeta.title}</h3>
              <p>{activeSectionMeta.description}</p>
            </div>
            {activeSectionStatusText ? (
              <span className="configuration-status-pill">
                {activeSectionStatusText}
              </span>
            ) : null}
          </header>

          {activeSection === "company" ? (
            <div className="configuration-company-grid">
              <section className="configuration-card">
                <h4>Identidad institucional</h4>
                <div className="configuration-form-grid">
                  <div className="field-group">
                    <label>
                      Razon social <span className="required-mark">*</span>
                    </label>
                    <input
                      type="text"
                      className={getFieldClassName(fieldErrors.legalName)}
                      value={form.legalName}
                      onChange={(event) =>
                        updateField("legalName", event.target.value)
                      }
                      placeholder="Ej. Access Quality S.A. de C.V."
                    />
                    <InlineFieldError message={fieldErrors.legalName} />
                    <p className="field-hint">
                      Se usara en documentos oficiales y encabezados
                      institucionales.
                    </p>
                  </div>
                  <div className="field-group">
                    <label>Nombre comercial</label>
                    <input
                      type="text"
                      value={form.commercialName}
                      onChange={(event) =>
                        updateField("commercialName", event.target.value)
                      }
                      placeholder="Ej. Access Quality"
                    />
                  </div>
                  <div className="field-group configuration-grid-span-full">
                    <label>Descripción institucional</label>
                    <textarea
                      rows="3"
                      className={getFieldClassName(fieldErrors.description)}
                      value={form.description}
                      onChange={(event) =>
                        updateField("description", event.target.value)
                      }
                      placeholder="Breve descripción para uso interno o documental"
                    />
                    <InlineFieldError message={fieldErrors.description} />
                  </div>
                </div>
              </section>

              <section className="configuration-card">
                <h4>Logo institucional</h4>
                <div className="configuration-logo-card">
                  <div className="configuration-logo-preview">
                    {form.logoUrl ? (
                      <img
                        src={form.logoUrl}
                        alt="Vista previa del logo institucional"
                      />
                    ) : (
                      <div className="configuration-logo-empty">
                        Sin logo cargado
                      </div>
                    )}
                  </div>
                  <div className="configuration-logo-actions">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(event) =>
                        handleLogoChange(event.target.files?.[0])
                      }
                    />
                    <p className="field-hint">
                      Formatos permitidos: JPG, PNG, WEBP. Tamano maximo: 2 MB.
                    </p>
                    {form.logoUrl ? (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => updateField("logoUrl", "")}
                      >
                        Quitar logo
                      </button>
                    ) : null}
                  </div>
                </div>
              </section>

              <section className="configuration-card">
                <h4>Datos fiscales</h4>
                <div className="configuration-form-grid">
                  <div className="field-group">
                    <label>
                      Registro fiscal <span className="required-mark">*</span>
                    </label>
                    <input
                      type="text"
                      className={getFieldClassName(fieldErrors.taxId)}
                      value={form.taxId}
                      onChange={(event) =>
                        updateField("taxId", event.target.value)
                      }
                      placeholder="Ej. RFC: AQU110118AV2"
                    />
                    <InlineFieldError message={fieldErrors.taxId} />
                  </div>
                </div>
              </section>

              <section className="configuration-card">
                <h4>Direccion</h4>
                <div className="configuration-form-grid">
                  <div className="field-group configuration-grid-span-full">
                    <label>
                      Direccion principal{" "}
                      <span className="required-mark">*</span>
                    </label>
                    <input
                      type="text"
                      className={getFieldClassName(fieldErrors.addressLine1)}
                      value={form.addressLine1}
                      onChange={(event) =>
                        updateField("addressLine1", event.target.value)
                      }
                      placeholder="Calle, numero y colonia"
                    />
                    <InlineFieldError message={fieldErrors.addressLine1} />
                  </div>
                  <div className="field-group configuration-grid-span-full">
                    <label>Direccion complementaria</label>
                    <input
                      type="text"
                      value={form.addressLine2}
                      onChange={(event) =>
                        updateField("addressLine2", event.target.value)
                      }
                      placeholder="Piso, oficina, referencia"
                    />
                  </div>
                  <div className="field-group">
                    <label>
                      Ciudad <span className="required-mark">*</span>
                    </label>
                    <input
                      type="text"
                      className={getFieldClassName(fieldErrors.city)}
                      value={form.city}
                      onChange={(event) =>
                        updateField("city", event.target.value)
                      }
                    />
                    <InlineFieldError message={fieldErrors.city} />
                  </div>
                  <div className="field-group">
                    <label>
                      Estado o region <span className="required-mark">*</span>
                    </label>
                    <input
                      type="text"
                      className={getFieldClassName(fieldErrors.stateRegion)}
                      value={form.stateRegion}
                      onChange={(event) =>
                        updateField("stateRegion", event.target.value)
                      }
                    />
                    <InlineFieldError message={fieldErrors.stateRegion} />
                  </div>
                  <div className="field-group">
                    <label>
                      Pais <span className="required-mark">*</span>
                    </label>
                    <select
                      className={getFieldClassName(fieldErrors.countryId)}
                      value={form.countryId}
                      onChange={(event) =>
                        updateField("countryId", event.target.value)
                      }
                    >
                      <option value="">Selecciona pais</option>
                      {countries.map((country) => (
                        <option key={country.id} value={country.id}>
                          {country.name}
                        </option>
                      ))}
                    </select>
                    <InlineFieldError message={fieldErrors.countryId} />
                  </div>
                  <div className="field-group">
                    <label>
                      Codigo postal <span className="required-mark">*</span>
                    </label>
                    <input
                      type="text"
                      className={getFieldClassName(fieldErrors.postalCode)}
                      value={form.postalCode}
                      onChange={(event) =>
                        updateField("postalCode", event.target.value)
                      }
                    />
                    <InlineFieldError message={fieldErrors.postalCode} />
                  </div>
                </div>
              </section>

              <section className="configuration-card">
                <h4>Contacto institucional</h4>
                <div className="configuration-form-grid">
                  <div className="field-group">
                    <label>Correo institucional</label>
                    <input
                      type="email"
                      className={getFieldClassName(fieldErrors.email)}
                      value={form.email}
                      onChange={(event) =>
                        updateField("email", event.target.value)
                      }
                      placeholder="contacto@empresa.com"
                    />
                    <InlineFieldError message={fieldErrors.email} />
                  </div>
                  <div className="field-group">
                    <label>Telefono institucional</label>
                    <input
                      type="text"
                      value={form.phone}
                      onChange={(event) =>
                        updateField("phone", event.target.value)
                      }
                      placeholder="+52 55 1234 5678"
                    />
                  </div>
                  <div className="field-group configuration-grid-span-full">
                    <label>Sitio web</label>
                    <input
                      type="url"
                      className={getFieldClassName(fieldErrors.website)}
                      value={form.website}
                      onChange={(event) =>
                        updateField("website", event.target.value)
                      }
                      placeholder="https://www.empresa.com"
                    />
                    <InlineFieldError message={fieldErrors.website} />
                  </div>
                </div>
              </section>
            </div>
          ) : null}

          {activeSection === "global" ? (
            <div className="configuration-section-stack">
              <ChatbotSettingsCard
                settings={chatbotSettings}
                latestUpdateText={latestChatbotSettingsUpdateText}
                saving={savingChatbotSettings}
                canSave={chatbotSettingsDirty}
                isDirty={chatbotSettingsDirty}
                onChange={updateChatbotSetting}
                onSave={saveChatbotSettings}
              />

              <CommercialSettingsCard
                settings={commercialSettings}
                stageSlaEntries={stageSlaEntries}
                stageWeightEntries={stageWeightEntries}
                leadExecutionGuideEntries={leadExecutionGuideEntries}
                campaignMatrixCatalogs={campaignMatrixCatalogs}
                latestUpdateText={latestCommercialSettingsUpdateText}
                saving={savingCommercialSettings}
                canSave={commercialSettingsDirty}
                isDirty={commercialSettingsDirty}
                onChange={updateCommercialSetting}
                onTimezoneChange={updateCommercialBusinessTimezone}
                onScreenDisplayMinutesChange={
                  updateCommercialScreenDisplayMinutes
                }
                onScreenRotationMinutesChange={
                  updateCommercialScreenRotationMinutes
                }
                onWeightChange={updateCommercialWeightSetting}
                onGuideChange={updateCommercialGuideSetting}
                onMatrixRowChange={updateCampaignMatrixRow}
                onAddMatrixRow={addCampaignMatrixRow}
                onRemoveMatrixRow={removeCampaignMatrixRow}
                onSave={saveCommercialSettings}
              />

              <TemporaryFeaturesCard
                settings={temporaryFeatureSettings}
                latestUpdateText={latestTemporaryFeaturesUpdateText}
                saving={savingTemporaryFeatures}
                canSave={temporaryFeaturesCanSave}
                isDirty={temporaryFeaturesDirty}
                onToggle={updateTemporaryFeatureSetting}
                onSave={saveTemporaryFeatureSettings}
              />

              <WorkspacePlaybookCard
                items={workspacePlaybooks}
                activatingVersionId={activatingWorkspaceVersionId}
                onActivate={activateWorkspacePlaybook}
              />

              <WorkspacePlaybookEditor
                playbook={workspacePlaybookDetail}
                savingKey={savingWorkspacePlaybookKey}
                onSaveStage={updateWorkspacePlaybookStage}
                onSaveCriterion={updateWorkspacePlaybookCriterion}
              />

              <section className="configuration-card">
                <div className="configuration-card-heading">
                  <div>
                    <h4>Resumen institucional activo</h4>
                    <p>
                      Vista consolidada del perfil que hoy consume la
                      aplicacion.
                    </p>
                  </div>
                  <span className="configuration-inline-pill">
                    {formatCompletionPercent(
                      requiredCompleted,
                      requiredFieldItems.length,
                    )}
                    %
                  </span>
                </div>

                <div className="configuration-metrics-grid">
                  <article className="configuration-metric-card">
                    <strong>
                      {formatCompletionLabel(
                        requiredCompleted,
                        requiredFieldItems.length,
                      )}
                    </strong>
                    <span>Campos obligatorios</span>
                  </article>
                  <article className="configuration-metric-card">
                    <strong>
                      {formatCompletionLabel(
                        optionalCompleted,
                        optionalFieldItems.length,
                      )}
                    </strong>
                    <span>Campos complementarios</span>
                  </article>
                  <article className="configuration-metric-card">
                    <strong>{auditEntries.length}</strong>
                    <span>Eventos recientes en auditoria</span>
                  </article>
                </div>

                <ConfigurationSummaryList items={summaryItems} />
              </section>

              <ConfigurationChecklist
                title="Cobertura minima requerida"
                description="Estos datos sostienen la identidad institucional y el branding documental compartido."
                items={requiredFieldItems}
              />

              <ConfigurationChecklist
                title="Cobertura complementaria"
                description="Estos campos mejoran el contexto operativo y la presentacion institucional."
                items={optionalFieldItems}
              />

              <ConfigurationBrandingPreview
                logoUrl={form.logoUrl}
                legalName={form.legalName}
                taxId={form.taxId}
                lines={brandingLines}
                email={form.email}
                phone={form.phone}
              />
            </div>
          ) : null}

          {activeSection === "modules" ? (
            <div className="configuration-section-stack">
              <section className="configuration-card">
                <div className="configuration-card-heading">
                  <div>
                    <h4>Impacto operativo por modulo</h4>
                    <p>
                      Esta configuracion ya tiene consumidores claros y deja
                      visible su alcance real.
                    </p>
                  </div>
                </div>
              </section>

              <ConfigurationModuleCards
                items={moduleItems}
                onOpenAudit={() => changeSection("audit")}
              />
            </div>
          ) : null}

          {activeSection === "catalogs" ? (
            <div className="configuration-section-stack">
              <section className="configuration-card">
                <div className="configuration-card-heading">
                  <div>
                    <h4>Tipos de cuenta</h4>
                    <p>
                      Administra catalogo para clasificar cuentas segun los
                      tipos ya definidos. Puedes crear, editar y
                      activar/desactivar tipos desde esta vista.
                    </p>
                  </div>
                  <span className="configuration-inline-pill">
                    {sortedAccountTypes.length} tipos
                  </span>
                </div>

                <div className="configuration-form-grid configuration-new-section-form">
                  <div className="field-group">
                    <label>Nombre del tipo</label>
                    <input
                      type="text"
                      value={accountTypeDraft.name}
                      onChange={(event) =>
                        updateAccountTypeDraft("name", event.target.value)
                      }
                      placeholder="Ej. Principal"
                    />
                  </div>
                  <div className="field-group">
                    <label>Codigo (opcional)</label>
                    <input
                      type="text"
                      value={accountTypeDraft.code}
                      onChange={(event) =>
                        updateAccountTypeDraft("code", event.target.value)
                      }
                      placeholder="Ej. principal"
                    />
                  </div>
                  <div className="field-group configuration-grid-span-full">
                    <label>Descripcion (opcional)</label>
                    <textarea
                      rows="2"
                      value={accountTypeDraft.description || ""}
                      onChange={(event) =>
                        updateAccountTypeDraft(
                          "description",
                          event.target.value,
                        )
                      }
                      placeholder="Ej. Tipo de cuenta para clientes estratégicos"
                    />
                  </div>
                  <div className="configuration-inline-actions">
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={accountTypeActionKey === "create"}
                      onClick={() => {
                        void createAccountType();
                      }}
                    >
                      {accountTypeActionKey === "create"
                        ? "Creando..."
                        : "Agregar tipo"}
                    </button>
                  </div>
                </div>

                <div className="configuration-sector-list">
                  {sortedAccountTypes.map((accountType) => {
                    const accountTypeId = Number(accountType?.id || 0);
                    const rowAction =
                      accountTypeActionKey === `rename:${accountTypeId}` ||
                      accountTypeActionKey === `status:${accountTypeId}`;
                    return (
                      <article
                        key={accountTypeId}
                        className="configuration-sector-item"
                      >
                        <div>
                          <strong>{accountType.name}</strong>
                          <p>
                            Codigo: {accountType.code || "-"} · Estado:{" "}
                            {accountType.isActive ? "Activo" : "Inactivo"}
                          </p>
                          {accountType.description ? (
                            <p>Descripcion: {accountType.description}</p>
                          ) : null}
                        </div>
                        <div className="configuration-inline-actions">
                          <button
                            type="button"
                            className="btn-secondary"
                            disabled={rowAction}
                            onClick={() => {
                              const nextName = window.prompt(
                                "Nuevo nombre del tipo de cuenta",
                                String(accountType.name || ""),
                              );
                              if (nextName === null) return;
                              const nextDescription = window.prompt(
                                "Descripcion del tipo de cuenta (opcional)",
                                String(accountType.description || ""),
                              );
                              if (nextDescription === null) return;
                              void renameAccountType(
                                accountTypeId,
                                nextName,
                                nextDescription,
                              );
                            }}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            className="btn-secondary"
                            disabled={rowAction}
                            onClick={() => {
                              void setAccountTypeStatus(
                                accountTypeId,
                                !accountType.isActive,
                              );
                            }}
                          >
                            {accountType.isActive ? "Desactivar" : "Activar"}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>

              <section className="configuration-card">
                <div className="configuration-card-heading">
                  <div>
                    <h4>Sectores economicos</h4>
                    <p>
                      Administra catalogo para cuentas. Puedes crear, editar y
                      activar/desactivar sectores desde esta vista.
                    </p>
                  </div>
                  <span className="configuration-inline-pill">
                    {sortedEconomicSectors.length} sectores
                  </span>
                </div>

                <div className="configuration-form-grid configuration-new-section-form">
                  <div className="field-group">
                    <label>Nombre del sector</label>
                    <input
                      type="text"
                      value={economicSectorDraft.name}
                      onChange={(event) =>
                        updateEconomicSectorDraft("name", event.target.value)
                      }
                      placeholder="Ej. Proveedor"
                    />
                  </div>
                  <div className="field-group">
                    <label>Codigo (opcional)</label>
                    <input
                      type="text"
                      value={economicSectorDraft.code}
                      onChange={(event) =>
                        updateEconomicSectorDraft("code", event.target.value)
                      }
                      placeholder="Ej. proveedor"
                    />
                  </div>
                  <div className="field-group configuration-grid-span-full">
                    <label>Descripcion (opcional)</label>
                    <textarea
                      rows="2"
                      value={economicSectorDraft.description || ""}
                      onChange={(event) =>
                        updateEconomicSectorDraft(
                          "description",
                          event.target.value,
                        )
                      }
                      placeholder="Ej. Sector enfocado en servicios de integración"
                    />
                  </div>
                  <div className="configuration-inline-actions">
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={economicSectorActionKey === "create"}
                      onClick={() => {
                        void createEconomicSector();
                      }}
                    >
                      {economicSectorActionKey === "create"
                        ? "Creando..."
                        : "Agregar sector"}
                    </button>
                  </div>
                </div>

                <div className="configuration-sector-list">
                  {sortedEconomicSectors.map((sector) => {
                    const sectorId = Number(sector?.id || 0);
                    const rowAction =
                      economicSectorActionKey === `rename:${sectorId}` ||
                      economicSectorActionKey === `status:${sectorId}`;
                    return (
                      <article
                        key={sectorId}
                        className="configuration-sector-item"
                      >
                        <div>
                          <strong>{sector.name}</strong>
                          <p>
                            Codigo: {sector.code || "-"} · Estado:{" "}
                            {sector.isActive ? "Activo" : "Inactivo"}
                          </p>
                          {sector.description ? (
                            <p>Descripcion: {sector.description}</p>
                          ) : null}
                        </div>
                        <div className="configuration-inline-actions">
                          <button
                            type="button"
                            className="btn-secondary"
                            disabled={rowAction}
                            onClick={() => {
                              const nextName = window.prompt(
                                "Nuevo nombre del sector",
                                String(sector.name || ""),
                              );
                              if (nextName === null) return;
                              const nextDescription = window.prompt(
                                "Descripcion del sector (opcional)",
                                String(sector.description || ""),
                              );
                              if (nextDescription === null) return;
                              void renameEconomicSector(
                                sectorId,
                                nextName,
                                nextDescription,
                              );
                            }}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            className="btn-secondary"
                            disabled={rowAction}
                            onClick={() => {
                              void setEconomicSectorStatus(
                                sectorId,
                                !sector.isActive,
                              );
                            }}
                          >
                            {sector.isActive ? "Desactivar" : "Activar"}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            </div>
          ) : null}

          {activeSection === "proposal_content" ? (
            <ProposalContentConfigurationPanel
              config={proposalContentConfig}
              loadError={proposalContentLoadError}
              componentDefinitions={proposalComponentDefinitions}
              assets={institutionalAssets}
              savingProposalContent={savingProposalContent}
              assetActionKey={assetActionKey}
              latestUpdateText={latestProposalContentUpdateText}
              onSaveComponent={saveProposalContentComponent}
              onCreateComponent={createProposalContentComponent}
              onReorderComponents={reorderProposalContent}
              onArchiveComponent={archiveProposalContentComponent}
              onRestoreComponent={restoreProposalContentComponent}
              onDeleteComponent={deleteProposalContent}
              onCreateAsset={createProposalAsset}
              onAddAssetVersion={addProposalAssetVersion}
              onArchiveAsset={archiveProposalAsset}
            />
          ) : null}

          {activeSection === "ai_budget" ? (
            <AiCreditConfigurationPanel
              items={aiWalletSummaries}
              loading={aiWalletSummariesLoading}
              error={aiWalletSummariesError}
              latestUpdateText={latestAiWalletUpdateText}
              pricingRates={aiPricingRates}
              pricingRatesLoading={aiPricingRatesLoading}
              pricingRatesError={aiPricingRatesError}
              latestPricingUpdateText={latestAiPricingUpdateText}
              pricingActionKey={aiPricingActionKey}
              pricingSyncPreview={aiPricingSyncPreview}
              selectedUserId={selectedAiWalletUserId}
              selectedDetail={selectedAiWalletDetail}
              detailLoading={selectedAiWalletDetailLoading}
              actionKey={aiWalletActionKey}
              onSelectUser={(userId) => {
                void selectAiWalletUser(userId);
              }}
              onGrantCredit={(userId, payload) =>
                grantAiWalletCredit(userId, payload)
              }
              onAdjustCredit={(userId, payload) =>
                adjustAiWalletCredit(userId, payload)
              }
              onUpdatePolicy={(userId, payload) =>
                updateAiWalletPolicy(userId, payload)
              }
              onCreatePricingRate={(payload) => createAiPricingRate(payload)}
              onClosePricingRate={(rateId, payload) =>
                closeAiPricingRate(rateId, payload)
              }
              onSyncPricingRates={(payload) => syncAiPricingRates(payload)}
            />
          ) : null}

          {activeSection === "ai_parameters" ? (
            <AiParametersConfigurationPanel
              config={aiParametersConfig}
              selectedCapabilityKey={selectedAiCapabilityKey}
              draft={aiParameterDraft}
              warnings={aiParameterValidationWarnings}
              revisions={aiParameterRevisions}
              changeSummary={aiChangeSummary}
              onChangeSummary={setAiChangeSummary}
              latestUpdateText={latestAiParametersUpdateText}
              saving={savingAiParameters}
              publishing={publishingAiParameters}
              validating={validatingAiParameters}
              restoringKey={restoringAiParameterKey}
              dirty={aiParametersDirty}
              formatDateTime={formatDateTime}
              onSelectCapability={selectAiCapability}
              onUpdateField={updateAiParameterField}
              onUpdateParameter={updateAiParameterParameter}
              onValidate={() => {
                void validateAiParametersDraft();
              }}
              onSaveDraft={() => {
                void saveAiParametersDraft(aiChangeSummary).then(() => {
                  setAiChangeSummary("");
                });
              }}
              onPublish={() => {
                void publishAiParameters();
              }}
              onRestoreRevision={(revisionNumber) => {
                void restoreAiParameterRevision(revisionNumber);
              }}
            />
          ) : null}

          {activeSection === "audit" ? (
            <ConfigurationAuditList
              entries={auditEntries}
              formatDateTime={formatDateTime}
              summarizeChangedFields={summarizeChangedFields}
            />
          ) : null}
        </div>
      </div>

      {activeSection === "company" && isDirty ? (
        <div className="configuration-bottom-bar">
          <span>Tienes cambios sin guardar</span>
          <div className="configuration-bottom-bar-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={discardChanges}
              disabled={saving}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={saveCompanyProfile}
              disabled={saving || !canSave}
            >
              {saving ? "Guardando..." : "Guardar cambios"}
            </button>
          </div>
        </div>
      ) : null}

      {activeSection === "ai_parameters" && aiParametersDirty ? (
        <div className="configuration-bottom-bar">
          <span>Tienes cambios de IA sin guardar</span>
          <div className="configuration-bottom-bar-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={discardChanges}
              disabled={savingAiParameters}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                void saveAiParametersDraft(aiChangeSummary).then(() => {
                  setAiChangeSummary("");
                });
              }}
              disabled={savingAiParameters}
            >
              {savingAiParameters ? "Guardando..." : "Guardar borrador"}
            </button>
          </div>
        </div>
      ) : null}

      {error ? <div className="toast toast-error">{error}</div> : null}
      {success ? <div className="toast toast-success">{success}</div> : null}
    </section>
  );
}
