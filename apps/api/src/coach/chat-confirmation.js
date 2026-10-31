import { createHash } from "node:crypto";

// What the seller may confirm from the chat itself. Everything else keeps going to the Coach as before.
// Both kinds already run through the controlled operation service (review, version, idempotency,
// permissions, stale checks, audit); this list only decides which ones the chat card may drive.
export const IN_CHAT_CONFIRMATION_KINDS = Object.freeze(["opportunity_note", "opportunity_field"]);
export const IN_CHAT_FIELD_ALLOWLIST = Object.freeze({
  opportunity_field: Object.freeze(["name", "amountUsd", "closeDate"]),
});
export const CONFIRMED_VIA_CUSTOMER_CHAT = "customer_chat";
export const OPERATION_OUTCOMES = Object.freeze(["confirmed", "discarded"]);

export function isInChatConfirmable(operation) {
  if (!operation || !IN_CHAT_CONFIRMATION_KINDS.includes(operation.kind)) return false;
  const fields = IN_CHAT_FIELD_ALLOWLIST[operation.kind];
  return !fields || fields.includes(String(operation.field || ""));
}

// Returns null when the chat may confirm this operation, otherwise the reason it may not.
export function inChatConfirmationBlock({ enabled, operation }) {
  if (!enabled) {
    return { status: 403, code: "CHAT_CONFIRMATION_DISABLED", message: "Confirmar cambios desde el chat no está habilitado." };
  }
  if (operation?.sourceChannel !== "customer_account") {
    return { status: 403, code: "CHAT_CONFIRMATION_ORIGIN", message: "Solo se confirman desde el chat las propuestas que nacieron en Cliente existente." };
  }
  if (!isInChatConfirmable(operation)) {
    return { status: 403, code: "CHAT_CONFIRMATION_KIND_NOT_ALLOWED", message: "Este tipo de cambio todavía se confirma en el Coach." };
  }
  return null;
}

// Identifies one proposal inside a conversation so an answered card stays answered after a reload.
// Only what the seller sees (what, where, new value) counts, never the value observed at review time.
export function chatOperationSignature(operation) {
  const target = Number(operation?.opportunityId || operation?.accountId || operation?.contactId || 0);
  const payload = [
    String(operation?.kind || ""),
    target,
    String(operation?.field || ""),
    String(operation?.kind === "opportunity_note" ? operation?.noteText ?? "" : operation?.value ?? "").replace(/\s+/g, " ").trim(),
  ].join("|");
  return createHash("sha1").update(payload).digest("hex");
}
