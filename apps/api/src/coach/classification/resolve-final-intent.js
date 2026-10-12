import { checkPermissions } from "../permissions/permission-checker.js";
import { chooseBestIntent, detectConflict } from "./conflict-rules.js";

function normalizeIntent(intent) {
  return String(intent || "").trim();
}

function mapIntentToMode(intent) {
  const map = {
    seller_coaching: "coaching",
    account_performance: "coaching",
    account_query: "brief_context",
    opportunity_query: "brief_context",
    create_opportunity: "operation",
    update_opportunity: "operation",
    general_query: "coaching",
    clarify_needed: "clarification",
  };

  return map[intent] || "brief_context";
}

function mapIntentToPolicy(intent) {
  const map = {
    seller_coaching: "seller_coaching",
    account_performance: "seller_coaching",
    account_query: "brief_context",
    opportunity_query: "brief_context",
    create_opportunity: "operation",
    update_opportunity: "operation",
    general_query: "default",
    clarify_needed: "default",
  };

  return map[intent] || "default";
}

function deriveAllowedTools(intent, permissions) {
  const permissionCheck = checkPermissions(intent, permissions, {});
  if (!permissionCheck.allowed) {
    return [];
  }

  const toolSpecific = {
    account_performance: ["read_account_summary", "read_opportunities"],
    seller_coaching: ["read_account_summary", "read_history"],
    opportunity_query: ["read_opportunities"],
    account_query: ["read_account_summary"],
    create_opportunity: ["create_opportunity"],
    update_opportunity: ["update_opportunity"],
    general_query: ["read_account_summary"],
  };

  return toolSpecific[intent] || [];
}

export function resolveFinalIntent(
  preDecision,
  semanticDecision,
  permissions = {},
  context = {},
) {
  const permissionCheck = checkPermissions(
    semanticDecision?.intent || "general_query",
    permissions,
    context,
  );

  if (!permissionCheck.allowed) {
    return {
      intent: "clarify_needed",
      interactionMode: "clarification",
      policyProcess: "default",
      allowedTools: [],
      requiresClarification: true,
      confidence: 0.95,
      reason: permissionCheck.reason || "operation_not_allowed",
      source: {
        b3: preDecision?.bucket || "unknown",
        semanticIntent: semanticDecision?.intent || "general_query",
        resolver: "permission_gate",
      },
    };
  }

  const conflict = detectConflict(preDecision, semanticDecision);
  const selectedIntent = normalizeIntent(
    chooseBestIntent(preDecision, semanticDecision, context),
  );

  if (conflict.isStrongConflict && (semanticDecision?.confidence || 0) < 0.7) {
    return {
      intent: "clarify_needed",
      interactionMode: "clarification",
      policyProcess: "default",
      allowedTools: [],
      requiresClarification: true,
      confidence: 0.7,
      reason: conflict.reason,
      source: {
        b3: preDecision?.bucket || "unknown",
        semanticIntent: semanticDecision?.intent || "general_query",
        resolver: "conflict_resolution",
      },
    };
  }

  const finalIntent = selectedIntent || "general_query";

  return {
    intent: finalIntent,
    interactionMode: mapIntentToMode(finalIntent),
    policyProcess: mapIntentToPolicy(finalIntent),
    allowedTools: deriveAllowedTools(finalIntent, permissions),
    requiresClarification: false,
    confidence: Math.max(
      0.5,
      Math.min(
        0.99,
        ((preDecision?.confidence || 0.5) +
          (semanticDecision?.confidence || 0.5)) /
          2,
      ),
    ),
    reason: "resolved",
    source: {
      b3: preDecision?.bucket || "unknown",
      semanticIntent: semanticDecision?.intent || "general_query",
      resolver: "final_decision",
    },
  };
}
