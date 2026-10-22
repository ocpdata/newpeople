const numberWords = {
  una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
};

export function requestedCustomerQuestionCount(component) {
  if (component.category !== "content.discovery_questions") return null;
  const text = String(component.text || "").toLowerCase();
  const matches = [...text.matchAll(/\b(\d+|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+preguntas?\b/g)]
    .map((match) => numberWords[match[1]] || Number(match[1]));
  const counts = [...new Set(matches)];
  return counts.length === 1 && Number.isSafeInteger(counts[0]) && counts[0] > 0
    ? counts[0] : null;
}

export function validateCustomerQuestions(items, count) {
  return Array.isArray(items) && items.length === count &&
    items.every((item) => typeof item === "string" && item.trim() &&
      !/[\r\n]/.test(item) && (item.match(/\?/g) || []).length <= 1) &&
    new Set(items.map((item) => item.trim().toLocaleLowerCase())).size === count;
}

export function latestCustomerDraft(history) {
  const last = [...history].reverse().find((message) => message.role === "assistant");
  if (last?.components?.length !== 1 || !last.components[0].category?.startsWith("content.") ||
      last.components[0].status !== "completed" || !String(last.text || "").trim()) return null;
  return { name: "Último borrador del chat", text: last.text, coverage: "complete", truncated: false };
}
