function textNode(text) {
  return text ? { type: "text", text } : null;
}

export function legacyBlocksToTiptap(blocks) {
  const content = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (block.type === "image" && block.image?.fileUrl) {
      content.push({
        type: "image",
        attrs: {
          src: block.image.fileUrl,
          alt: block.image.altText || null,
          title: block.image.caption || null,
          width: block.image.width || null,
          height: block.image.height || null,
        },
      });
      continue;
    }
    if (block.type === "heading") {
      const headingText = textNode(block.text || "");
      content.push({
        type: "heading",
        attrs: { level: 2 },
        content: headingText ? [headingText] : [],
      });
      continue;
    }
    if (block.type === "list") {
      const items = (block.items || []).filter(Boolean).map((item) => ({
        type: "listItem",
        content: [{ type: "paragraph", content: [textNode(item)] }],
      }));
      if (items.length) content.push({ type: "bulletList", content: items });
      continue;
    }
    if (block.type === "paragraph" || block.text) {
      content.push({
        type: "paragraph",
        content: [textNode(block.text || "")].filter(Boolean),
      });
    }
  }
  return { type: "doc", content };
}
