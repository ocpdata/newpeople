export function buildEvidenceReferences(evidence) {
  const references = [];
  if (evidence?.account?.id) {
    references.push(`account:${evidence.account.id}`);
  }
  if (evidence?.contact?.id) {
    references.push(`contact:${evidence.contact.id}`);
  }
  if (evidence?.opportunity?.id) {
    references.push(`opportunity:${evidence.opportunity.id}`);
  }
  for (const contact of evidence?.contacts || []) {
    references.push(`contact:${contact.id}`);
  }
  for (const opportunity of evidence?.opportunities || []) {
    references.push(`opportunity:${opportunity.id}`);
  }
  for (const quotation of evidence?.quotations || []) {
    references.push(`quotation:${quotation.id}`);
  }
  for (const proposal of evidence?.proposals || []) {
    references.push(`proposal:${proposal.id}`);
  }
  for (const account of evidence?.accounts || []) {
    references.push(`account:${account.id}`);
  }
  for (const doc of evidence?.documentation || []) {
    references.push(
      `doc:${doc.filePath}${typeof doc.chunkIndex === "number" ? `#${doc.chunkIndex}` : ""}`,
    );
  }
  for (const item of evidence?.applicationKnowledge || []) {
    references.push(`app:${item.id}`);
  }
  return [...new Set(references)].slice(0, 20);
}
