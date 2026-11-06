import { z } from "zod";

export const PURCHASE_ORDER_CORRECTION_PERMISSION =
  "aceptar_pedido.procesamiento.modificar_culminacion_orden_compra";

export function purchaseOrderCorrectionOptions(req) {
  const header = req.get("X-Purchase-Order-Correction-Reason");
  if (header === undefined) return { reason: null };
  if (!req.user?.permissionSet?.has(PURCHASE_ORDER_CORRECTION_PERMISSION)) {
    throw Object.assign(new Error("No autorizado para modificar datos de culminacion de orden de compra"), { status: 403 });
  }
  let reason;
  try {
    reason = decodeURIComponent(header);
  } catch {
    throw Object.assign(new Error("Motivo de modificacion invalido"), { status: 400 });
  }
  const parsed = z.string().trim().min(10).max(1000).safeParse(reason);
  if (!parsed.success) {
    throw Object.assign(new Error("Indica un motivo de entre 10 y 1000 caracteres"), { status: 400 });
  }
  return { reason: parsed.data };
}

export async function lockPurchaseOrderStage(connection, quotationId, { reason } = {}) {
  await connection.query("SELECT id FROM quotations WHERE id = ? FOR UPDATE", [quotationId]);
  const [rows] = await connection.query(
    `SELECT * FROM quotation_processing_stages
     WHERE quotation_id = ? AND stage_code = 'provider_purchase_order' FOR UPDATE`,
    [quotationId],
  );
  const stage = rows[0] || null;
  if (stage?.status_code === "completed" && !reason) {
    throw Object.assign(new Error("Orden de compra culminada. Usa Modificar datos de culminacion."), { status: 409 });
  }
  if (reason && stage?.status_code !== "completed") {
    throw Object.assign(new Error("Solo se pueden corregir datos de una etapa culminada. Recarga el procesamiento."), { status: 409 });
  }
  return stage;
}
