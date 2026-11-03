import { z } from "zod";

export const purchaseOrderValueSchema = z.object({
  amount: z.number().finite().nonnegative().max(9999999999999.99)
    .refine((value) => Number(value.toFixed(2)) === value, "El importe admite hasta dos decimales"),
  currencyCode: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
}).strict();
