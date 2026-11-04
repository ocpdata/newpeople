import { runStructuredTextResearch } from "../structuredWebResearch.js";
import {
  SEMANTIC_CLASSIFIER_DEFAULTS,
  loadSemanticClassifierPrompt,
} from "../coach/semantic-classifier-prompts.js";
import { routeChannelIntentByCode } from "../coach/channel-intents.js";

export const PROSPECT_CLASSIFIER_FEATURE_CODE = "prospect_research.chat_classifier";

const CONFIDENCE = { high: 0.95, medium: 0.75 };
const RECENT_MESSAGES = 4;
const MESSAGE_LIMIT = 300;
const CLASSIFIER_TIMEOUT_MS = 12000;

// The pattern classifier stays as the fallback, so the AI classifier can be switched off without redeploying.
export function prospectClassifierEnabled(env = process.env) {
  return String(env.PROSPECT_SEMANTIC_CLASSIFIER ?? "true").toLowerCase() !== "false";
}

async function loadInstruction(loadPrompt) {
  try {
    const prompt = await loadPrompt({ channel: "prospect" });
    if (String(prompt?.instruction || "").trim()) return prompt.instruction;
  } catch {
    // A missing or unreachable configuration falls back to the built-in instruction.
  }
  return SEMANTIC_CLASSIFIER_DEFAULTS.prospect;
}

// Picks the intent of the seller's request among the enabled catalog entries. Returns a routing object shaped like the
// pattern classifier's, or null when the model is unavailable, unsure or answers outside the catalog.
export async function classifyProspectIntent({
  question,
  history = [],
  catalog = [],
  availableTools = [],
  context = {},
  coverage = null,
  userId,
  jobId = null,
  call = runStructuredTextResearch,
  loadPrompt = loadSemanticClassifierPrompt,
  timeoutMs = CLASSIFIER_TIMEOUT_MS,
} = {}) {
  if (!prospectClassifierEnabled()) return null;
  const enabled = (Array.isArray(catalog) ? catalog : []).filter((intent) => intent?.enabled !== false);
  const codes = enabled.map((intent) => intent.code);
  if (!codes.length || !String(question || "").trim()) return null;
  const instruction = await loadInstruction(loadPrompt);
  let raw;
  try {
    raw = await call({
      schemaName: "prospect_intent_classification",
      systemPrompt: instruction,
      subject: "Clasificación de la intención del vendedor en Cuenta nueva",
      context: {
        question: String(question).slice(0, 1000),
        recentConversation: (Array.isArray(history) ? history : []).slice(-RECENT_MESSAGES).map((message) => ({
          role: message.role === "assistant" || message.role === "coach" ? "assistant" : "user",
          text: String(message.text || "").slice(0, MESSAGE_LIMIT),
        })),
        sessionCoverage: coverage,
        intents: enabled.map(({ code, label, description, examples }) => ({ code, label, description, examples })),
      },
      currentValues: {},
      fields: [
        { key: "intent", type: "enum", enum: codes, example: codes[codes.length - 1] },
        { key: "confidence", type: "enum", enum: ["high", "medium", "low"], example: "high" },
        { key: "reason", type: "string", example: "Pide priorizar a quién contactar." },
      ],
      aiUsageContext: {
        userId: Number(userId),
        featureCode: PROSPECT_CLASSIFIER_FEATURE_CODE,
        jobType: "prospect_chat_classifier",
        jobId,
      },
      signal: AbortSignal.timeout(timeoutMs),
      maxOutputTokens: 300,
    });
  } catch (error) {
    console.error("[prospect-chat] Intent classifier failed", { jobId, code: error?.code || error?.name });
    return null;
  }
  const confidence = CONFIDENCE[raw?.confidence];
  if (!raw || !codes.includes(raw.intent) || !confidence) return null;
  return routeChannelIntentByCode({
    channel: "prospect",
    code: raw.intent,
    availableTools,
    context,
    configuration: catalog,
    confidence,
    source: "semantic",
    reason: String(raw.reason || "").slice(0, 200),
  });
}
