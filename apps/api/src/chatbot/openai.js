import { config } from "../config.js";
import { getChatbotSettings } from "../settings.js";

export async function fetchChatbotCompletion(payload, purpose = "chatbot") {
  const settings = await getChatbotSettings();
  const timeoutMs = Math.max(5000, Number(settings?.requestTimeoutMs || 60000));
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  try {
    const response = await fetch(
      `${config.openai.baseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.openai.apiKey}`,
        },
        body: JSON.stringify(payload),
        ...(controller ? { signal: controller.signal } : {}),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenAI ${purpose} request failed: ${response.status} ${errorText}`,
      );
    }

    return response.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`OpenAI ${purpose} request exceeded ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export async function fetchChatbotEmbedding({
  input,
  model = "text-embedding-3-small",
}) {
  const settings = await getChatbotSettings();
  const timeoutMs = Math.max(5000, Number(settings?.requestTimeoutMs || 60000));
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  try {
    const response = await fetch(
      `${config.openai.baseUrl.replace(/\/$/, "")}/embeddings`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.openai.apiKey}`,
        },
        body: JSON.stringify({ model, input }),
        ...(controller ? { signal: controller.signal } : {}),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenAI embedding request failed: ${response.status} ${errorText}`,
      );
    }

    const payload = await response.json();
    return Array.isArray(payload?.data?.[0]?.embedding)
      ? payload.data[0].embedding
      : null;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`OpenAI embedding request exceeded ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
