const MAX_COMPLETED_ITEMS = 12;

// The model sometimes announces a list ("…el siguiente paso registrado si existe:") and stops. The verified facts that
// came with the answer are the list it meant to write, so they complete the text instead of leaving it empty.
export function completeAnswerFromFacts(response) {
  const answer = String(response?.answer || "").trim();
  const facts = Array.isArray(response?.facts) ? response.facts : [];
  if (!answer || !/:$/.test(answer)) return { response, completed: 0 };
  const items = facts
    .filter((fact) => String(fact?.label || "").trim())
    .slice(0, MAX_COMPLETED_ITEMS)
    .map((fact) => {
      const label = String(fact.label).trim();
      const excerpt = String(fact.excerpt || "").trim();
      return excerpt ? `- **${label}**: ${excerpt}` : `- **${label}**`;
    });
  if (!items.length) return { response, completed: 0 };
  return {
    response: { ...response, answer: `${answer}\n\n${items.join("\n")}` },
    completed: items.length,
  };
}
