import {
  createCoachSession,
  getCoachOperation,
  persistCoachOperations,
  updateCoachOperation,
  transitionCoachOperation,
} from "../coach/service.js";
import { coachOperationSchema } from "../coach/contract.js";

export async function loadCustomerPendingActivity(userId, context) {
  if (!context?.pendingActivity?.operationId) return null;
  const persisted = await getCoachOperation(
    userId,
    context.pendingActivity.operationId,
  );
  if (
    !persisted ||
    !["collecting", "ready", "proposed", "failed"].includes(persisted.status) ||
    persisted.sessionId !== Number(context.pendingActivity.sessionId) ||
    persisted.kind !== "activity" ||
    Number(persisted.pendingOperation.accountId) !== Number(context.accountId)
  )
    return null;
  return {
    operationId: persisted.id,
    sessionId: persisted.sessionId,
    version: persisted.version,
    operation: persisted.pendingOperation,
    temporalPreference: context.pendingActivity.temporalPreference || "",
  };
}

export async function persistCustomerActivityDraft({
  userId,
  response,
  context,
  originalIntent,
}) {
  const prior = context?.pendingActivity;
  if (response.activityDraftDiscarded) {
    if (prior) {
      const existing = await getCoachOperation(userId, prior.operationId);
      if (
        existing &&
        Number(existing.pendingOperation.accountId) ===
          Number(context.accountId)
      ) {
        await transitionCoachOperation(userId, existing.id, {
          status: "cancelled",
          version: existing.version,
          cancellationReason: "Descartada en Cliente existente",
        });
      }
    }
    return null;
  }
  if (!response.activityDraft) return prior || null;
  const draft = response.activityDraft;
  const parsed = coachOperationSchema.safeParse({
    ...draft.operation,
    sourceChannel: "coach",
  });
  if (!parsed.success)
    throw new Error(
      "Los datos del borrador de actividad no son válidos. Revisa objetivo, fecha y vínculos.",
    );
  const operation = parsed.data;
  let persisted;
  if (prior) {
    const existing = await getCoachOperation(userId, prior.operationId);
    if (
      !existing ||
      Number(existing.pendingOperation.accountId) !== Number(context.accountId)
    )
      throw new Error("El borrador pendiente no está disponible");
    const updated = await updateCoachOperation(userId, existing.id, {
      pendingOperation: operation,
      missingFields: operation.missingFields,
      version: prior.version || existing.version,
    });
    if (updated.outcome !== "updated")
      throw new Error(
        "El borrador cambió o ya está cerrado. Actualiza la conversación.",
      );
    persisted = updated.operation;
  } else {
    const session = await createCoachSession(userId, {
      accountId: operation.accountId,
      opportunityId: operation.opportunityId,
      contactId: operation.contactId,
    });
    [persisted] = await persistCoachOperations({
      userId,
      sessionId: session.id,
      originalIntent,
      entities: {
        accountId: operation.accountId,
        opportunityId: operation.opportunityId,
        contactId: operation.contactId,
      },
      operations: [operation],
    });
    if (!persisted)
      throw new Error("No fue posible guardar el borrador de actividad");
  }
  response.operations = [
    {
      ...persisted.pendingOperation,
      sourceChannel: "customer_account",
      persistentId: persisted.id,
      persistenceVersion: persisted.version,
      persistenceStatus: persisted.status,
      coachSessionId: persisted.sessionId,
    },
  ];
  return {
    operationId: persisted.id,
    sessionId: persisted.sessionId,
    version: persisted.version,
    operation: persisted.pendingOperation,
    temporalPreference: draft.temporalPreference,
  };
}
