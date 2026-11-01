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
  "Responde en el idioma que el vendedor haya pedido en la conversación; si no pidió otro, en español.",
].join("\n");

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
    publicResearchRun: Boolean(snapshot.externalResearch),
    notRegistered,
  };
}
