// The language a seller asked the chat to answer in, shared by the Coach and Cuenta nueva chats.
const LANGUAGE_NAMES = {
  ingles: "inglés", english: "inglés", frances: "francés", french: "francés",
  portugues: "portugués", portuguese: "portugués", espanol: "español", spanish: "español",
};
const LANGUAGE_REQUEST = /\b(?:responde|respondeme|contesta|escribe|habla|answer|reply|respond|write|speak)\b[^.?!\n]{0,30}\b(?:en|in) (ingles|english|frances|french|portugues|portuguese|espanol|spanish)\b/;

const plain = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// The most recent language the seller asked for, so it is stated to the model instead of left for it to find in history.
export function requestedLanguage({ question, history = [] } = {}) {
  const texts = [
    ...(Array.isArray(history) ? history : []).filter((turn) => ["user", "seller"].includes(turn?.role)).map((turn) => turn.text),
    question,
  ];
  let language = null;
  for (const text of texts) {
    const match = LANGUAGE_REQUEST.exec(plain(text));
    if (match) language = LANGUAGE_NAMES[match[1]];
  }
  return language;
}

export function languageInstruction(language) {
  return language
    ? `\n\nIdioma pedido por el vendedor: ${language}. Escribe TODA la respuesta en ${language}, incluidos los hallazgos, contactos y fuentes.`
    : "";
}
