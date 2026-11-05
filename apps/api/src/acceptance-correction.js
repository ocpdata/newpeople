import { z } from "zod";

export const ACCEPTANCE_CORRECTION_PERMISSION = "aceptar_pedido.procesamiento.modificar_aceptacion";

export const acceptanceCorrectionSchema = z.object({
  acceptedAt: z.iso.datetime(),
  notes: z.string().max(20000).nullable(),
}).strict();

export function acceptanceCorrectionOptions(req) {
  const reason = req.get("X-Acceptance-Correction-Reason");
  if (reason === undefined) return { allowAccepted: false };
  if (!req.user?.permissionSet?.has(ACCEPTANCE_CORRECTION_PERMISSION)) {
    throw Object.assign(new Error("No autorizado para modificar datos de aceptación"), { status: 403 });
  }
  let decoded;
  try {
    decoded = decodeURIComponent(reason);
  } catch {
    throw Object.assign(new Error("Motivo de corrección inválido"), { status: 400 });
  }
  const parsed = z.string().trim().min(10).max(1000).safeParse(decoded);
  if (!parsed.success) {
    throw Object.assign(new Error("Indica un motivo de corrección de entre 10 y 1000 caracteres"), { status: 400 });
  }
  return { allowAccepted: true, reason: parsed.data };
}
