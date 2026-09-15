export function shouldPreventSectionHeadingKey(key, from) {
  const directParent = from?.parent;
  const container = typeof from?.node === "function" ? from.node(-1) : null;
  const childIndex = typeof from?.index === "function" ? from.index(from.depth) : -1;
  const previousSibling = container && childIndex > 0 ? container.child(childIndex - 1) : null;
  const isSectionHeading =
    directParent?.type?.name === "heading" &&
    Number(directParent.attrs?.level) === 2;
  const previousIsSectionHeading =
    previousSibling?.type?.name === "heading" &&
    Number(previousSibling.attrs?.level) === 2;

  if (key === "Enter" && isSectionHeading) {
    return true;
  }

  if (key === "Backspace") {
    if (isSectionHeading && from?.parentOffset === 0) {
      return true;
    }

    if (
      directParent?.type?.name === "paragraph" &&
      from?.parentOffset === 0 &&
      previousIsSectionHeading
    ) {
      return true;
    }
  }

  return false;
}
