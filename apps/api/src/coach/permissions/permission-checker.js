import { TOOL_ALLOWLIST } from "./tool-allowlist.js";

export function checkPermissions(intent, permissions = {}, context = {}) {
  const normalizedPermissions = {
    canReadAccounts: Boolean(permissions.canReadAccounts),
    canReadOpportunities: Boolean(permissions.canReadOpportunities),
    canWriteOpportunities: Boolean(permissions.canWriteOpportunities),
    canReadHistory: Boolean(permissions.canReadHistory),
    ...permissions,
  };

  if (!intent || intent === "clarify_needed") {
    return { allowed: true, reason: "clarification_required" };
  }

  const required = {
    account_performance: ["canReadAccounts"],
    seller_coaching: ["canReadAccounts"],
    account_query: ["canReadAccounts"],
    opportunity_query: ["canReadAccounts", "canReadOpportunities"],
    create_opportunity: ["canWriteOpportunities"],
    update_opportunity: ["canWriteOpportunities"],
    general_query: ["canReadAccounts"],
  };

  const requiredFlags = required[intent] || [];
  const missing = requiredFlags.filter((flag) => !normalizedPermissions[flag]);

  if (
    missing.length &&
    intent !== "seller_coaching" &&
    intent !== "account_performance"
  ) {
    return {
      allowed: false,
      reason: "operation_not_allowed",
      missing,
    };
  }

  return {
    allowed: true,
    allowedTools: TOOL_ALLOWLIST[intent] || [],
  };
}
