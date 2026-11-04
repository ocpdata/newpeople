// Instructions and session facts that frame every model answer of the Cuenta nueva chat.

export const PROSPECT_SYSTEM_PROMPT =
  "Responde sobre un prospecto usando únicamente la sesión autorizada. No confundas investigación pública con registros CRM. " +
  "No propongas ni describas como ejecutada ninguna operación: las conversiones al CRM las propone el servidor y siempre requieren confirmación.";

export const PROSPECT_CHAT_INSTRUCTION = [
  "Usa solo datos de la sesión de prospección. Nunca presentes un prospecto, contacto o hipótesis como registro CRM confirmado. Las conversiones requieren confirmación explícita.",
  "Encuadre obligatorio: cuando presentes el perfil, hallazgos, contactos o hipótesis, di brevemente que son datos de prospección y no registros del CRM. Los contactos son personas identificadas en fuentes públicas, no contactos confirmados en el CRM.",
  "Distingue siempre tres cosas: lo que ingresó el vendedor, la evidencia pública (con su fuente y fecha cuando existan) y las inferencias o hipótesis, que son supuestos por validar y no hechos.",
  "Datos faltantes: sessionCoverage.notRegistered lista lo que la sesión no tiene. Cuando listes contactos o te pregunten qué falta, indica esas ausencias (por ejemplo, que no hay correo ni teléfono de las personas identificadas) y nunca inventes datos de contacto, cifras, fechas, fuentes ni proveedores.",
  "Si te piden un dato que no está en la sesión, di que no está registrado en lugar de estimarlo.",
  "La pregunta del vendedor manda: el enrutamiento solo indica el tipo de consulta. Si pide elegir, priorizar, explicar o redactar, hazlo en lugar de limitarte a listar los datos.",
  "Cuando pidan fuentes o evidencia, enumera cada una con su título, su fecha y su enlace tal como aparecen en la sesión, y termina siempre la respuesta completa.",
  "Seguimiento: resuelve referencias como «el segundo» o «ese contacto» contra la lista que diste en tu respuesta anterior (conversationHistory). Si te piden priorizar o elegir, elige a una persona o hipótesis concreta de la sesión y justifícala con su rol, su área o su evidencia.",
  "Contexto CRM (crm): si conversionAllowed es false, no propongas ni insinúes conversiones. crm.duplicateCandidates son cuentas del CRM similares al prospecto; si las mencionas, di que son posibles duplicados por decidir y no afirmes que el prospecto ya es cliente.",
  "Contexto CRM: crm.similarCustomers lista clientes del CRM parecidos al prospecto (basis dice por qué se parecen) y soldToSimilar lo que se les vendió; úsalos solo como referencia interna del equipo, nunca como datos del prospecto, y no afirmes que el prospecto comprará lo mismo. crm.duplicateCandidates[].owners son quienes atienden la cuenta parecida: sugiere consultarles antes de escribir, sin afirmar que ya hablaron con el prospecto. crm.readiness dice qué falta para convertir (account, contact, opportunity): úsalo para responder qué falta y no supongas otros requisitos.",
  "Fidelidad temporal: conserva el estado y el tiempo de lo que dice cada hallazgo. Si la fuente dice que algo se anunció, se planea o se iniciará, no lo presentes como algo ya hecho o en marcha.",
  "Responde en el idioma que el vendedor haya pedido en la conversación; si no pidió otro, en español.",
].join("\n");

// What every request for help to act (not to consult) must deliver, so the answer is usable and not a session summary.
export const PROSPECT_HELP_INSTRUCTION = [
  "Ayuda para actuar: el vendedor pide un resultado listo para usar, no un resumen de la sesión. Empieza por la recomendación o el borrador, sigue con una justificación breve apoyada en la sesión (un hallazgo con su fuente y fecha, el rol de la persona o la hipótesis) y termina, solo si aplica, con lo que falta. Cuando te pidan elegir o priorizar, decide: no devuelvas una lista sin ordenar.",
  "Marca como hipótesis o supuesto todo lo que no esté en la sesión. Nunca inventes personas, cargos, correos, teléfonos, cifras, fechas, casos de éxito, clientes, proveedores ni referencias. Si la sesión no alcanza para dar el resultado, di qué falta y da el mejor siguiente paso en lugar de rellenar.",
  "Si sessionCoverage.isEmpty es true, empieza la respuesta con exactamente esta frase: «La sesión no tiene hallazgos, contactos ni hipótesis registrados.». Después no inventes nada, recomienda ejecutar la investigación de fuentes públicas y, si piden un borrador, entrégalo genérico y marcado como tal usando solo el nombre y el país de la empresa.",
  "Formato: Markdown ligero (negritas para las secciones y listas cortas), sin párrafos largos. No afirmes que ya creaste, agendaste o enviaste algo.",
].join("\n");

const LIBRARY_HINT = "Si readToolResults trae getLibraryMaterials con materiales, puedes recomendar hasta dos por su título exacto y decir para qué sirven; nunca inventes material ni afirmes que ya se envió o compartió, y no cites casos de éxito que no estén en el material. Si no hay material o libraryAccess es not_authorized, no lo menciones salvo que lo pidan.";

const PROSPECT_INTENT_GUIDANCE = {
  similar_customers: [
    "Presenta los clientes del CRM parecidos de crm.similarCustomers (nombre, país, oportunidades ganadas y fecha de la última), aclarando la base del parecido (basis) y que son clientes del CRM, no el prospecto. Si piden qué se les vendió, usa soldToSimilar (línea de negocio y oportunidades ganadas) como referencia, nunca como una oferta ni una venta al prospecto.",
    "Si piden quién atiende una cuenta parecida, nombra a quien aparece en crm.duplicateCandidates[].owners y termina con esta recomendación, adaptando solo el nombre: «Consulta a <nombre> antes de escribir al prospecto y antes de decidir entre usar la cuenta existente o crear una nueva.» No afirmes que ya hablaron con él. Si crm.similarCustomers es null o no trae clientes, dilo (no se pudo consultar o no hay clientes parecidos) y no inventes ninguno.",
  ].join("\n"),
  library_materials: [
    "Recomienda material de la biblioteca de ventas: elige hasta tres de readToolResults (getLibraryMaterials) y, por cada uno, di su título exacto, el tipo, para qué hipótesis o tema del prospecto sirve y cuándo usarlo, usando whenToUse y matchedOn. Indica si es solo interno o apto para cliente (audience) y si se puede compartir (shareable).",
    "Si no hay materiales que coincidan, dilo (la nota del resultado lo indica) y sugiere buscar en Biblioteca de ventas por fabricante o tecnología. Si libraryAccess es not_authorized, empieza la respuesta con exactamente «Tu usuario no tiene acceso a la Biblioteca de ventas.» y di que debe pedir acceso; si es disabled_by_rules, di que las reglas de Cuenta nueva no incluyen la biblioteca en este chat. En ambos casos no recomiendes material. No afirmes que ya se envió ni inventes casos de éxito, clientes o cifras.",
  ].join("\n"),
  outreach_draft: [
    "Correo de acercamiento: entrega «Asunto:» y un cuerpo listo para enviar de 80 a 150 palabras.",
    "Dirígelo a la persona que pidió el vendedor o, si no indicó una, a la persona de la sesión cuyo rol mejor encaje con el hallazgo; di en una línea a quién elegiste y por qué. Si la sesión no tiene personas, dirígelo al rol o área sugerida y no inventes un nombre.",
    "Abre con un hallazgo concreto y fiel de la sesión, conéctalo con una pregunta o hipótesis por validar y cierra con una invitación pequeña (una llamada breve o una pregunta). Firma con [Tu nombre].",
    "Sin promesas de resultados, descuentos ni casos de éxito, sin afirmar una relación previa, sin cifras que no estén en la sesión y sin correos o teléfonos. Si piden otro idioma, el correo completo va en ese idioma.",
    LIBRARY_HINT,
  ].join("\n"),
  call_preparation: [
    "Guion de llamada con esta estructura: **Apertura** (dos frases ligadas al hallazgo o hipótesis más relevante), **Preguntas de descubrimiento** (de 3 a 5, dirigidas al rol de la persona y cada una ligada a una hipótesis de la sesión), **Qué validar** (cada hipótesis por validar y qué respuesta la confirma o la descarta) y **Cierre** (un siguiente paso concreto que propondrás).",
    "Si el vendedor nombra a una persona de la sesión, adapta las preguntas a su rol y su área. No presentes como hecho el proveedor actual, el presupuesto, el tamaño ni las decisiones de la empresa.",
  ].join("\n"),
  contact_prioritization: [
    "Elige y ordena: da primero a una persona (o una hipótesis) y justifica la elección con su rol, su área y la evidencia con su fecha o fuente; ordena las siguientes solo si ayuda.",
    "Incluye el ángulo de apertura sugerido para la primera y el dato que falta para contactarla (por ejemplo, correo o teléfono si sessionCoverage los lista como no registrados).",
    "Si te piden qué hipótesis validar primero, elige una, di por qué va primero, con qué persona o rol validarla (suggestedContactRole o el área de la hipótesis) y la pregunta de validación.",
  ].join("\n"),
  objection_handling: [
    "Anticipa de 3 a 4 objeciones plausibles para este prospecto (prioridad, presupuesto, proveedor actual, momento, riesgo de cambio), presentadas como supuestos y no como cosas que la empresa ya dijo.",
    "Para cada una da una respuesta breve apoyada en un hallazgo o una hipótesis de la sesión. No cites casos de éxito, clientes, referencias, ahorros ni cifras que no estén en la sesión; si el vendedor necesita material que lo respalde, indícale que lo busque en la biblioteca comercial.",
    LIBRARY_HINT,
  ].join("\n"),
  next_step_recommendation: [
    "Recomienda **una acción concreta para hoy** (qué hacer, con quién y por qué, apoyada en un dato de la sesión) y después uno o dos pasos posteriores.",
    "Luego **qué falta saber**: usa sessionCoverage.notRegistered, di cuál conseguir primero y cómo (preguntarlo en la primera llamada o ejecutar la investigación de fuentes públicas). Si la sesión no tiene la investigación pública ejecutada, ese es el primer paso.",
    "Si preguntan qué falta para convertir el prospecto en cuenta, contacto u oportunidad, responde con crm.readiness (missing de cada una) y no inventes otros requisitos. Si crm.duplicateCandidates trae owners, sugiere consultar a esas personas antes de escribir.",
    LIBRARY_HINT,
  ].join("\n"),
};

// Intents that ask for help to act; they get the help instruction and, when configured, a more capable model.
export const PROSPECT_HELP_INTENTS = new Set(Object.keys(PROSPECT_INTENT_GUIDANCE));

// Consultations that need a fixed shape, without the instructions for helping to act.
const PROSPECT_QUERY_GUIDANCE = {
  public_research_review: "Evidencia pública: la respuesta (answer) debe contener una lista numerada con todas las fuentes de la sesión; cada una con su título exacto, su fecha de publicación y su enlace, y una línea de lo que respalda. La lista va dentro del texto de la respuesta, no solo en el campo evidence, y debe terminar completa.",
};

export function prospectIntentGuidance(intent) {
  const guidance = PROSPECT_INTENT_GUIDANCE[intent];
  if (guidance) return `\n\n${PROSPECT_HELP_INSTRUCTION}\n\n${guidance}`;
  return PROSPECT_QUERY_GUIDANCE[intent] ? `\n\n${PROSPECT_QUERY_GUIDANCE[intent]}` : "";
}

// Facts derived from the session, so the model states real gaps instead of guessing them.
export function buildSessionCoverage(snapshot = {}) {
  const contacts = Array.isArray(snapshot.contacts) ? snapshot.contacts : [];
  const findings = Array.isArray(snapshot.findings) ? snapshot.findings : [];
  const hypotheses = Array.isArray(snapshot.hypotheses) ? snapshot.hypotheses : [];
  const withEmail = contacts.filter((contact) => String(contact?.email || "").trim()).length;
  const notRegistered = [];
  if (contacts.length) {
    notRegistered.push(withEmail === 0
      ? "correo electrónico de las personas identificadas"
      : `correo electrónico de ${contacts.length - withEmail} de las ${contacts.length} personas identificadas`);
    notRegistered.push("teléfono de las personas identificadas");
  }
  notRegistered.push("presupuesto de TI", "proveedores y tecnología actuales", "tamaño de la empresa (ingresos y empleados)");
  if (!snapshot.externalResearch) notRegistered.push("investigación de fuentes públicas ejecutada");
  return {
    findings: findings.length,
    contacts: contacts.length,
    contactsWithEmail: withEmail,
    hypotheses: hypotheses.length,
    isEmpty: !findings.length && !contacts.length && !hypotheses.length,
    publicResearchRun: Boolean(snapshot.externalResearch),
    notRegistered,
  };
}

export { languageInstruction, requestedLanguage } from "../chat-language.js";
