import { z } from "zod";
import { kobo, operationMetadata, operationSource, quantity } from "./inventory.schemas";
import { validCalendarDay } from "../services/lagos-time";

const at = z.number().int().nonnegative().max(8_640_000_000_000_000)
  .refine(value => value <= Date.now() + 5 * 60_000, "Recorded time cannot be in the future").optional();
const repayment = z.object({ clientId: z.uuid(), amount: kobo.refine(value => value > 0n), at }).strict();
const create = z.object({
  clientId: z.uuid(), items: z.array(z.object({ productId: z.uuid(),
    quantity: quantity.refine(value => value.gt(0)), unitPrice: kobo.optional() }).strict()).min(1).max(500),
  amountPaid: kobo.optional(),
  customerId: z.uuid().optional(), customer: z.object({ clientId: z.uuid().optional(),
    name: z.string().trim().min(1).max(200), phone: z.string().trim().max(30).optional() }).strict().optional(),
  payments: z.array(repayment).max(500).default([]),
  fromOffline: z.boolean().default(false), source: operationSource, metadata: operationMetadata, at,
}).strict().refine(value => !(value.customerId && value.customer), "Choose an existing customer or provide a new one")
  .refine(value => new Set(value.payments.map(payment => payment.clientId)).size === value.payments.length,
    "Repayment IDs must be unique");
const day = z.string().refine(validCalendarDay, "Use a valid YYYY-MM-DD date");
export const salesSchemas = {
  create,
  batch: z.object({ clientId: z.uuid(), sales: z.array(create).min(1).max(100), metadata: operationMetadata }).strict()
    .refine(value => new Set([value.clientId, ...value.sales.map(sale => sale.clientId)]).size === value.sales.length + 1)
    .refine(value => value.sales.reduce((sum, sale) => sum + sale.items.length, 0) <= 1000),
  reverse: z.object({ clientId: z.uuid(), reason: z.string().trim().min(1).max(1000).default("Entered by mistake"),
    metadata: operationMetadata, source: operationSource }).strict(),
  payment: repayment.extend({ metadata: operationMetadata, source: operationSource }).strict(),
  list: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().max(512).optional(),
    from: day.optional(), to: day.optional() }).strict().refine(value => !value.from || !value.to || value.from <= value.to),
};
export type CreateSale = z.infer<typeof salesSchemas.create>;
export type SaleBatch = z.infer<typeof salesSchemas.batch>;
export type ReverseSale = z.infer<typeof salesSchemas.reverse>;
export type Repayment = z.infer<typeof salesSchemas.payment>;
export type SalesQuery = z.infer<typeof salesSchemas.list>;
