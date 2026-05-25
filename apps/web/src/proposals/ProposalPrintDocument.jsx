import "./proposal-print.css";

function normalizeSectionLayoutConfig(section) {
  const explicitMode = String(
    section?.layoutConfig?.mode || section?.layout || "",
  )
    .trim()
    .toLowerCase();
  if (
    explicitMode === "stack" ||
    explicitMode === "horizontal-gallery" ||
    explicitMode === "manual-rows"
  ) {
    if (explicitMode !== "manual-rows") {
      return { mode: explicitMode };
    }

    const rows = Array.isArray(section?.layoutConfig?.rows)
      ? section.layoutConfig.rows
          .map((row) => ({
            blockIndexes: Array.isArray(row?.blockIndexes)
              ? row.blockIndexes.filter((index) => Number.isInteger(index))
              : [],
          }))
          .filter((row) => row.blockIndexes.length > 0)
      : [];

    return rows.length ? { mode: explicitMode, rows } : { mode: explicitMode };
  }

  const title = String(section?.title || "")
    .trim()
    .toLowerCase();
  const subtitle = String(section?.subtitle || "")
    .trim()
    .toLowerCase();
  return {
    mode:
      title === "certificaciones" || subtitle === "certifications"
        ? "horizontal-gallery"
        : "stack",
  };
}

function getProposalSectionLayout(section) {
  return normalizeSectionLayoutConfig(section).mode;
}

function isHorizontalGallerySection(section) {
  return getProposalSectionLayout(section) === "horizontal-gallery";
}

function isGalleryCompatibleBlock(block) {
  return block?.type === "image" && Boolean(block?.image?.fileUrl);
}

function splitSectionBlocksForLayout(section) {
  const blocks = Array.isArray(section?.blocks) ? section.blocks : [];
  const layoutConfig = normalizeSectionLayoutConfig(section);

  if (layoutConfig.mode === "manual-rows") {
    const rowByStartIndex = new Map();
    const rowBlockIndexes = new Set();

    (layoutConfig.rows || []).forEach((row) => {
      const resolvedEntries = row.blockIndexes
        .map((blockIndex) => ({
          blockIndex,
          block: blocks[blockIndex],
        }))
        .filter(({ block }) => isGalleryCompatibleBlock(block));

      if (!resolvedEntries.length) {
        return;
      }

      rowByStartIndex.set(
        resolvedEntries[0].blockIndex,
        resolvedEntries.map((entry) => entry.block),
      );
      resolvedEntries.forEach((entry) => rowBlockIndexes.add(entry.blockIndex));
    });

    return blocks.reduce((segments, block, blockIndex) => {
      if (rowByStartIndex.has(blockIndex)) {
        segments.push({
          type: "gallery",
          blocks: rowByStartIndex.get(blockIndex),
          isManualRow: true,
        });
        return segments;
      }

      if (rowBlockIndexes.has(blockIndex)) {
        return segments;
      }

      segments.push({ type: "block", block });
      return segments;
    }, []);
  }

  if (layoutConfig.mode !== "horizontal-gallery") {
    return blocks.map((block) => ({ type: "block", block }));
  }

  const leadingBlocks = [];
  const galleryBlocks = [];
  const trailingBlocks = [];
  let seenGallery = false;

  for (const block of blocks) {
    if (isGalleryCompatibleBlock(block)) {
      seenGallery = true;
      galleryBlocks.push(block);
      continue;
    }

    if (seenGallery) {
      trailingBlocks.push(block);
    } else {
      leadingBlocks.push(block);
    }
  }

  return [
    ...leadingBlocks.map((block) => ({ type: "block", block })),
    ...(galleryBlocks.length
      ? [{ type: "gallery", blocks: galleryBlocks, isManualRow: false }]
      : []),
    ...trailingBlocks.map((block) => ({ type: "block", block })),
  ];
}

function renderProposalBlock(block, key, section) {
  if (block.type === "heading") {
    return <h3 key={key}>{block.text}</h3>;
  }

  if (block.type === "paragraph") {
    return <p key={key}>{block.text}</p>;
  }

  if (block.type === "list") {
    return (
      <ul key={key}>
        {(block.items || []).map((item, index) => (
          <li key={`${key}-${index}`}>{item}</li>
        ))}
      </ul>
    );
  }

  if (block.type === "image" && block.image?.fileUrl) {
    const imageClassName = isHorizontalGallerySection(section)
      ? "proposal-print-image is-compact"
      : "proposal-print-image";
    const figureCaption = block.image.caption;

    return (
      <figure key={key} className={imageClassName}>
        <img
          src={block.image.fileUrl}
          alt={block.image.altText || block.title || "Imagen de propuesta"}
        />
        {figureCaption ? <figcaption>{figureCaption}</figcaption> : null}
      </figure>
    );
  }

  return null;
}

function renderProposalGalleryItem(block, key, section) {
  if (!isGalleryCompatibleBlock(block)) {
    return null;
  }

  const figureCaption = block.image.caption || "";

  return (
    <figure key={key} className="proposal-print-gallery-item">
      <div className="proposal-print-gallery-item-image">
        <img
          src={block.image.fileUrl}
          alt={block.image.altText || block.title || section.title || "Imagen"}
        />
      </div>
      {figureCaption ? (
        <figcaption className="proposal-print-gallery-item-caption">
          {figureCaption}
        </figcaption>
      ) : null}
    </figure>
  );
}

function renderProposalSectionBody(section) {
  const segments = splitSectionBlocksForLayout(section);

  return (
    <div
      className={`proposal-print-section-body${
        getProposalSectionLayout(section) === "horizontal-gallery"
          ? " is-horizontal-gallery"
          : ""
      }`}
    >
      {segments.map((segment, segmentIndex) => {
        if (segment.type === "gallery") {
          return (
            <div
              key={`${section.id}-gallery-${segmentIndex}`}
              className={`proposal-print-gallery${
                segment.isManualRow ? " is-manual-row" : ""
              }`}
              style={
                segment.isManualRow && segment.blocks.length
                  ? {
                      gridTemplateColumns: `repeat(${segment.blocks.length}, minmax(0, 1fr))`,
                    }
                  : undefined
              }
            >
              {segment.blocks.map((block, blockIndex) =>
                renderProposalGalleryItem(
                  block,
                  `${section.id}-gallery-${segmentIndex}-${blockIndex}`,
                  section,
                ),
              )}
            </div>
          );
        }

        return renderProposalBlock(
          segment.block,
          `${section.id}-block-${segmentIndex}`,
          section,
        );
      })}
    </div>
  );
}

export default function ProposalPrintDocument({ model }) {
  if (!model) {
    return null;
  }

  return (
    <div className="proposal-print-sheet" data-testid="proposal-print-sheet">
      <header
        className={`proposal-print-cover is-${model.coverStyle || "corporate"}`}
      >
        <div className="proposal-print-cover-copy">
          <span className="proposal-print-eyebrow">Propuesta comercial</span>
          <h1>{model.title || "Propuesta sin titulo"}</h1>
        </div>
        <div className="proposal-print-cover-meta">
          <span>{model.updatedAtLabel}</span>
        </div>
      </header>

      <section className="proposal-print-metadata-grid">
        <article className="proposal-print-info-card">
          <small>Cuenta</small>
          <strong>{model.accountName || "Sin cuenta asociada"}</strong>
        </article>
        <article className="proposal-print-info-card">
          <small>Contacto</small>
          <strong>{model.contactName || "Sin contacto asignado"}</strong>
        </article>
      </section>

      <div className="proposal-print-sections">
        {model.sections.map((section) => (
          <section
            key={section.id}
            className={
              isHorizontalGallerySection(section)
                ? "proposal-print-section is-certifications"
                : "proposal-print-section"
            }
          >
            <div className="proposal-print-section-head">
              <div>
                <div className="proposal-print-section-title">
                  {section.title}
                </div>
              </div>
            </div>

            {renderProposalSectionBody(section)}
          </section>
        ))}
      </div>
    </div>
  );
}
