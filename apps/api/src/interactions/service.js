import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { summarizeForPrompt } from "../opportunity-documents/service.js";

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s@._-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildBigrams(value) {
  const normalized = normalizeText(value).replace(/\s/g, "");
  if (!normalized) return new Set();
  if (normalized.length === 1) return new Set([normalized]);

  const pairs = new Set();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    pairs.add(normalized.slice(index, index + 2));
  }
  return pairs;
}

function calculateSimilarity(left, right) {
  const leftNormalized = normalizeText(left);
  const rightNormalized = normalizeText(right);
  if (!leftNormalized || !rightNormalized) return 0;
  if (leftNormalized === rightNormalized) return 1;
  if (
    leftNormalized.length >= 6 &&
    rightNormalized.length >= 6 &&
    (leftNormalized.includes(rightNormalized) ||
      rightNormalized.includes(leftNormalized))
  ) {
    return 0.93;
  }

  const leftPairs = buildBigrams(leftNormalized);
  const rightPairs = buildBigrams(rightNormalized);
  let overlap = 0;
  leftPairs.forEach((pair) => {
    if (rightPairs.has(pair)) overlap += 1;
  });
  return (2 * overlap) / (leftPairs.size + rightPairs.size || 1);
}

function extractResponseOutputText(data) {
  const directOutputText = String(data?.output_text || "").trim();
  if (directOutputText) return directOutputText;

  const outputEntries = Array.isArray(data?.output) ? data.output : [];
  return (
    outputEntries
      .flatMap((entry) => (Array.isArray(entry?.content) ? entry.content : []))
      .filter((part) => part?.type === "output_text")
      .map((part) => String(part?.text || "").trim())
      .find(Boolean) || ""
  );
}

function extractJsonObject(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function ensureArrayOfStrings(values, maxItems = 12) {
  const unique = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = String(value || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!normalized) continue;
    const key = normalizeText(normalized);
    if (!key || unique.has(key)) continue;
    unique.set(key, normalized);
    if (unique.size >= maxItems) break;
  }
  return Array.from(unique.values());
}

function parseNameParts(fullName) {
  const parts = String(fullName || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (!parts.length) {
    return { firstName: "", lastName: "" };
  }
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "Interaccion" };
  }
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts.slice(-1).join(" "),
  };
}

function extractEmails(text) {
  return ensureArrayOfStrings(
    Array.from(
      String(text || "").matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi),
    ).map((match) => match[0]),
    10,
  );
}

function extractPhones(text) {
  return ensureArrayOfStrings(
    Array.from(String(text || "").matchAll(/(?:\+?\d[\d\s().-]{7,}\d)/g)).map(
      (match) => match[0],
    ),
    10,
  );
}

function extractLabeledValue(text, labels) {
  const regex = new RegExp(`(?:^|\\n)\\s*(?:${labels})\\s*:\\s*(.+)$`, "im");
  const match = String(text || "").match(regex);
  return match
    ? String(match[1] || "")
        .replace(/\s+/g, " ")
        .trim()
    : "";
}

function extractOpportunityLabels(text) {
  return ensureArrayOfStrings(
    Array.from(
      String(text || "").matchAll(
        /(?:^|\n)\s*(?:oportunidad|proyecto|solucion|servicio|producto|propuesta)\s*[:\-]\s*(.+)$/gim,
      ),
    ).map((match) => match[1]),
    8,
  );
}

function buildHeuristicInteractionAnalysis({ text, title, sourceNotes }) {
  const mergedText = [sourceNotes, text].filter(Boolean).join("\n\n");
  const emails = extractEmails(mergedText);
  const phones = extractPhones(mergedText);
  const accountName =
    extractLabeledValue(mergedText, "cuenta|empresa|cliente|prospecto") || "";
  const contactName =
    extractLabeledValue(mergedText, "contacto|asistente") || "";
  const topics = ensureArrayOfStrings(
    Array.from(
      String(mergedText).matchAll(
        /(?:^|\n)\s*(?:tema|temas|discusion|discutido)\s*[:\-]\s*(.+)$/gim,
      ),
    ).map((match) => match[1]),
    10,
  );
  const actionsTaken = ensureArrayOfStrings(
    Array.from(
      String(mergedText).matchAll(
        /(?:^|\n)\s*(?:accion realizada|acciones realizadas|accion|acciones)\s*[:\-]\s*(.+)$/gim,
      ),
    ).map((match) => match[1]),
    10,
  );
  const nextSteps = ensureArrayOfStrings(
    Array.from(
      String(mergedText).matchAll(
        /(?:^|\n)\s*(?:proximo paso|proximos pasos|siguiente paso|next step)\s*[:\-]\s*(.+)$/gim,
      ),
    ).map((match) => match[1]),
    10,
  );
  const opportunityNames = extractOpportunityLabels(mergedText);
  const contacts = [];

  if (contactName || emails.length || phones.length) {
    const nameParts = parseNameParts(
      contactName || emails[0]?.split("@")[0] || "Contacto",
    );
    contacts.push({
      suggestionId: `contact_${randomUUID().replace(/-/g, "")}`,
      fullName: [nameParts.firstName, nameParts.lastName].join(" ").trim(),
      firstName: nameParts.firstName,
      lastName: nameParts.lastName,
      email: emails[0] || "",
      phone: phones[0] || "",
      mobile: "",
      positionTitle: "",
      department: "",
      confidence: contactName ? "medium" : "low",
      reason: contactName
        ? "Se detecto una referencia textual a un contacto."
        : "Se detectaron datos de contacto en el contenido.",
      candidates: [],
      selectedContactId: null,
      matchStatus: "no_match",
    });
  }

  const opportunities = opportunityNames.map((name, index) => ({
    suggestionId: `opportunity_${randomUUID().replace(/-/g, "")}_${index + 1}`,
    name,
    summary: summarizeForPrompt(mergedText, 500),
    amountUsd: null,
    closeDate: "",
    contactSuggestionId: contacts[0]?.suggestionId || null,
    businessLineName: "",
    sellerName: "",
    presalesName: "",
    confidence: "low",
    reason: "Se detecto una referencia textual a una oportunidad o proyecto.",
    candidates: [],
    selectedOpportunityId: null,
    selectedBusinessLineId: null,
    selectedSellerUserId: null,
    selectedPresalesUserId: null,
    matchStatus: "no_match",
  }));

  return {
    summary:
      summarizeForPrompt(
        mergedText || title || "Interaccion sin contenido util",
        600,
      ) || "",
    topics,
    actionsTaken,
    nextSteps,
    warnings: mergedText
      ? []
      : ["No fue posible extraer contenido util de los archivos subidos."],
    suggestedAccount: {
      name: accountName,
      website: "",
      phone: phones[0] || "",
      city: "",
      stateRegion: "",
      countryId: null,
      description: summarizeForPrompt(mergedText, 1000),
      confidence: accountName ? "medium" : "low",
      reason: accountName
        ? "Se detecto una referencia textual a la cuenta o prospecto."
        : "No se identifico claramente una cuenta; se requiere revision manual.",
      candidates: [],
      selectedAccountId: null,
      matchStatus: "no_match",
    },
    suggestedContacts: contacts,
    suggestedOpportunities: opportunities,
  };
}

function mergeHeuristicAnalysis(aiAnalysis, heuristicAnalysis) {
  const account = {
    ...heuristicAnalysis.suggestedAccount,
    ...(aiAnalysis?.suggestedAccount || {}),
  };

  const contacts =
    Array.isArray(aiAnalysis?.suggestedContacts) &&
    aiAnalysis.suggestedContacts.length
      ? aiAnalysis.suggestedContacts
      : heuristicAnalysis.suggestedContacts;
  const opportunities =
    Array.isArray(aiAnalysis?.suggestedOpportunities) &&
    aiAnalysis.suggestedOpportunities.length
      ? aiAnalysis.suggestedOpportunities
      : heuristicAnalysis.suggestedOpportunities;

  return {
    summary:
      String(aiAnalysis?.summary || "").trim() || heuristicAnalysis.summary,
    topics: ensureArrayOfStrings(
      aiAnalysis?.topics || heuristicAnalysis.topics,
    ),
    actionsTaken: ensureArrayOfStrings(
      aiAnalysis?.actionsTaken || heuristicAnalysis.actionsTaken,
    ),
    nextSteps: ensureArrayOfStrings(
      aiAnalysis?.nextSteps || heuristicAnalysis.nextSteps,
    ),
    warnings: ensureArrayOfStrings([
      ...(Array.isArray(aiAnalysis?.warnings) ? aiAnalysis.warnings : []),
      ...heuristicAnalysis.warnings,
    ]),
    suggestedAccount: account,
    suggestedContacts: (Array.isArray(contacts) ? contacts : []).map(
      (contact) => {
        const fullName = String(
          contact?.fullName || contact?.name || "",
        ).trim();
        const parts = parseNameParts(
          fullName ||
            [contact?.firstName, contact?.lastName].filter(Boolean).join(" "),
        );
        return {
          suggestionId:
            contact?.suggestionId ||
            `contact_${randomUUID().replace(/-/g, "")}`,
          fullName:
            fullName ||
            [parts.firstName, parts.lastName].filter(Boolean).join(" "),
          firstName: String(contact?.firstName || parts.firstName || "").trim(),
          lastName: String(contact?.lastName || parts.lastName || "").trim(),
          email: String(contact?.email || "").trim(),
          phone: String(contact?.phone || "").trim(),
          mobile: String(contact?.mobile || "").trim(),
          positionTitle: String(contact?.positionTitle || "").trim(),
          department: String(contact?.department || "").trim(),
          confidence:
            String(contact?.confidence || "medium").trim() || "medium",
          reason: String(
            contact?.reason || "Sugerido a partir del analisis del contenido.",
          ).trim(),
          candidates: [],
          selectedContactId: null,
          matchStatus: "no_match",
        };
      },
    ),
    suggestedOpportunities: (Array.isArray(opportunities)
      ? opportunities
      : []
    ).map((opportunity) => ({
      suggestionId:
        opportunity?.suggestionId ||
        `opportunity_${randomUUID().replace(/-/g, "")}`,
      name: String(opportunity?.name || "").trim(),
      summary: String(opportunity?.summary || "").trim(),
      amountUsd:
        opportunity?.amountUsd === null || opportunity?.amountUsd === undefined
          ? null
          : Number(opportunity.amountUsd),
      closeDate: String(opportunity?.closeDate || "").trim(),
      contactSuggestionId: opportunity?.contactSuggestionId || null,
      businessLineName: String(opportunity?.businessLineName || "").trim(),
      sellerName: String(opportunity?.sellerName || "").trim(),
      presalesName: String(opportunity?.presalesName || "").trim(),
      confidence:
        String(opportunity?.confidence || "medium").trim() || "medium",
      reason: String(
        opportunity?.reason || "Sugerido a partir del analisis del contenido.",
      ).trim(),
      candidates: [],
      selectedOpportunityId: null,
      selectedBusinessLineId: null,
      selectedSellerUserId: null,
      selectedPresalesUserId: null,
      matchStatus: "no_match",
    })),
  };
}

async function analyzeInteractionTextWithAi({ title, sourceNotes, text }) {
  const trimmedText = summarizeForPrompt(
    [title, sourceNotes, text].filter(Boolean).join("\n\n"),
    18000,
  );
  if (!trimmedText || !config.openai.apiKey) {
    return null;
  }

  const payload = {
    model: config.openai.model,
    input: [
      {
        role: "system",
        content:
          "Analiza interacciones comerciales privadas y responde solo con JSON valido. Identifica la cuenta prospecto, contactos, temas discutidos, acciones realizadas, siguientes pasos y posibles oportunidades de venta. No inventes IDs internos. Cuando falte certeza, devuelve confianza baja.",
      },
      {
        role: "user",
        content: JSON.stringify({
          title,
          sourceNotes,
          content: trimmedText,
          expectedJsonShape: {
            summary: "",
            topics: [""],
            actionsTaken: [""],
            nextSteps: [""],
            warnings: [""],
            suggestedAccount: {
              name: "",
              website: "",
              phone: "",
              city: "",
              stateRegion: "",
              countryId: null,
              description: "",
              confidence: "high|medium|low",
              reason: "",
            },
            suggestedContacts: [
              {
                fullName: "",
                firstName: "",
                lastName: "",
                email: "",
                phone: "",
                mobile: "",
                positionTitle: "",
                department: "",
                confidence: "high|medium|low",
                reason: "",
              },
            ],
            suggestedOpportunities: [
              {
                name: "",
                summary: "",
                amountUsd: null,
                closeDate: "",
                contactSuggestionId: null,
                businessLineName: "",
                sellerName: "",
                presalesName: "",
                confidence: "high|medium|low",
                reason: "",
              },
            ],
          },
        }),
      },
    ],
  };

  const response = await fetch(
    `${config.openai.baseUrl.replace(/\/$/, "")}/responses`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openai.apiKey}`,
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  return extractJsonObject(extractResponseOutputText(data));
}

function resolveMatchStatus(candidates) {
  if (!candidates.length) return "no_match";
  if (candidates.length === 1 && candidates[0].score >= 0.92) {
    return "single_match";
  }
  return "multiple_matches";
}

function pickTopCandidates(candidates) {
  return candidates
    .filter((candidate) => candidate.score >= 0.45)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);
}

function buildEntityCandidates(rows, detectedValue, labelGetter) {
  return pickTopCandidates(
    rows
      .map((row) => ({
        id: Number(row.id),
        label: String(labelGetter(row) || "").trim(),
        score: calculateSimilarity(detectedValue, labelGetter(row)),
      }))
      .filter((candidate) => candidate.label),
  );
}

function selectSingleMatch(candidates) {
  return candidates.length === 1 && candidates[0].score >= 0.92
    ? Number(candidates[0].id)
    : null;
}

function buildBusinessLineMatch(businessLines, businessLineName) {
  if (!businessLineName) return { selectedId: null, candidates: [] };
  const candidates = buildEntityCandidates(
    businessLines,
    businessLineName,
    (row) => row.name,
  );
  return { selectedId: selectSingleMatch(candidates), candidates };
}

function buildUserRoleMatch(users, userName) {
  if (!userName) return { selectedId: null, candidates: [] };
  const candidates = buildEntityCandidates(
    users,
    userName,
    (row) => row.full_name,
  );
  return { selectedId: selectSingleMatch(candidates), candidates };
}

export async function analyzeInteractionEvidence({
  title,
  sourceNotes,
  documentExtractions,
  accessibleContext,
}) {
  const mergedText = documentExtractions
    .map((extraction) => extraction.normalizedText || extraction.rawText || "")
    .filter(Boolean)
    .join("\n\n");
  const heuristicAnalysis = buildHeuristicInteractionAnalysis({
    text: mergedText,
    title,
    sourceNotes,
  });
  const aiAnalysis = await analyzeInteractionTextWithAi({
    title,
    sourceNotes,
    text: mergedText,
  }).catch(() => null);
  const analysis = mergeHeuristicAnalysis(aiAnalysis, heuristicAnalysis);
  const warnings = ensureArrayOfStrings([
    ...analysis.warnings,
    ...documentExtractions.flatMap((extraction) => extraction.warnings || []),
  ]);

  const accountCandidates = analysis.suggestedAccount?.name
    ? buildEntityCandidates(
        accessibleContext.accounts,
        analysis.suggestedAccount.name,
        (row) => row.name,
      )
    : [];
  analysis.suggestedAccount = {
    ...analysis.suggestedAccount,
    candidates: accountCandidates,
    selectedAccountId: selectSingleMatch(accountCandidates),
    matchStatus: resolveMatchStatus(accountCandidates),
  };

  const accountScopedContacts = analysis.suggestedAccount.selectedAccountId
    ? accessibleContext.contacts.filter(
        (contact) =>
          Number(contact.account_id) ===
          Number(analysis.suggestedAccount.selectedAccountId),
      )
    : accessibleContext.contacts;

  analysis.suggestedContacts = analysis.suggestedContacts.map((contact) => {
    const seed = `${contact.email || ""} ${contact.fullName || ""}`.trim();
    const candidates = seed
      ? buildEntityCandidates(
          accountScopedContacts,
          seed,
          (row) => row.full_name,
        )
      : [];
    return {
      ...contact,
      candidates,
      selectedContactId: selectSingleMatch(candidates),
      matchStatus: resolveMatchStatus(candidates),
    };
  });

  const accountScopedOpportunities = analysis.suggestedAccount.selectedAccountId
    ? accessibleContext.opportunities.filter(
        (opportunity) =>
          Number(opportunity.account_id) ===
          Number(analysis.suggestedAccount.selectedAccountId),
      )
    : accessibleContext.opportunities;

  analysis.suggestedOpportunities = analysis.suggestedOpportunities.map(
    (opportunity) => {
      const candidates = opportunity.name
        ? buildEntityCandidates(
            accountScopedOpportunities,
            opportunity.name,
            (row) => row.name,
          )
        : [];
      const businessLineMatch = buildBusinessLineMatch(
        accessibleContext.businessLines,
        opportunity.businessLineName,
      );
      const sellerMatch = buildUserRoleMatch(
        accessibleContext.sellerUsers,
        opportunity.sellerName,
      );
      const presalesMatch = buildUserRoleMatch(
        accessibleContext.presalesUsers,
        opportunity.presalesName,
      );

      return {
        ...opportunity,
        candidates,
        selectedOpportunityId: selectSingleMatch(candidates),
        selectedBusinessLineId: businessLineMatch.selectedId,
        businessLineCandidates: businessLineMatch.candidates,
        selectedSellerUserId: sellerMatch.selectedId,
        sellerCandidates: sellerMatch.candidates,
        selectedPresalesUserId: presalesMatch.selectedId,
        presalesCandidates: presalesMatch.candidates,
        matchStatus: resolveMatchStatus(candidates),
      };
    },
  );

  return {
    summary: analysis.summary,
    topics: analysis.topics,
    actionsTaken: analysis.actionsTaken,
    nextSteps: analysis.nextSteps,
    warnings,
    suggestedAccount: analysis.suggestedAccount,
    suggestedContacts: analysis.suggestedContacts,
    suggestedOpportunities: analysis.suggestedOpportunities,
    processingStatus: mergedText ? "analyzed" : "requires_review",
  };
}

export function buildDefaultOpportunityDraft({
  suggestion,
  resolvedAccountId,
  resolvedContactId,
  businessLines,
  sellerUsers,
  presalesUsers,
  currentUserId,
}) {
  const today = new Date();
  const closeDate = new Date(today);
  closeDate.setDate(closeDate.getDate() + 30);
  const defaultBusinessLineId =
    suggestion?.selectedBusinessLineId || businessLines[0]?.id || null;
  const defaultSellerUserId =
    suggestion?.selectedSellerUserId ||
    currentUserId ||
    sellerUsers[0]?.id ||
    null;
  const defaultPresalesUserId =
    suggestion?.selectedPresalesUserId || presalesUsers[0]?.id || null;

  return {
    name: String(suggestion?.name || "").trim(),
    accountId: resolvedAccountId || null,
    contactId: resolvedContactId || null,
    amountUsd:
      suggestion?.amountUsd === null || suggestion?.amountUsd === undefined
        ? null
        : Number(suggestion.amountUsd),
    closeDate:
      String(suggestion?.closeDate || "").trim() ||
      closeDate.toISOString().slice(0, 10),
    businessLineId: defaultBusinessLineId
      ? Number(defaultBusinessLineId)
      : null,
    sellerUserId: defaultSellerUserId ? Number(defaultSellerUserId) : null,
    presalesUserId: defaultPresalesUserId
      ? Number(defaultPresalesUserId)
      : null,
    summary: String(suggestion?.summary || "").trim(),
  };
}
