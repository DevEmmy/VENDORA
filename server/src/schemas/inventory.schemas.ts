import { z } from "zod";
import { Prisma } from "../generated/prisma/client";

const quantityInput = z.union([z.string().max(30).regex(/^-?\d+(?:\.\d+)?$/), z.number().finite()]);
export const quantity = quantityInput.transform(value => {
  if (typeof value === "number") {
    const rounded = Math.round(value * 1000) / 1000;
    // Accept arithmetic noise such as 0.1+0.2, not genuine fourth decimals.
    if (Math.abs(value - rounded) <= Number.EPSILON * Math.max(1, Math.abs(value)) * 4) value = rounded;
  }
  return new Prisma.Decimal(String(value));
})
  .refine(value => value.isFinite() && value.decimalPlaces() <= 3 && value.abs().lte("999999999.999"),
    "Quantity must fit Decimal(12,3)");
const nonnegative = quantity.refine(value => value.gte(0));
const positive = quantity.refine(value => value.gt(0));
export const kobo = z.union([z.string().regex(/^\d{1,19}$/), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)])
  .transform(value => BigInt(value)).refine(value => value <= 9223372036854775807n);
const metadata = z.record(z.string().min(1).max(80), z.union([
  z.string().max(2000), z.number().finite(), z.boolean(), z.null(),
])).refine(value => Object.keys(value).length <= 20).default({});
const fields = {
  name: z.string().trim().min(1).max(200), unit: z.string().trim().min(1).max(80),
  aliases: z.array(z.string().trim().min(1).max(200)).max(20),
  unitPrice: kobo, costPrice: kobo.nullable(), lowStockAt: nonnegative,
};
const source = z.enum(["app", "tap", "voice", "offline", "whatsapp", "manual"]).default("app");
export const inventorySchemas = {
  id: z.uuid(),
  create: z.object({ ...fields, clientId: z.uuid(), unit: fields.unit.default("piece"),
    aliases: fields.aliases.default([]), costPrice: fields.costPrice.default(null),
    lowStockAt: fields.lowStockAt.default(new Prisma.Decimal(5)),
    openingQty: nonnegative.default(new Prisma.Decimal(0)), metadata, source }).strict(),
  update: z.object({ clientId: z.uuid(), name: fields.name.optional(), unit: fields.unit.optional(),
    aliases: fields.aliases.optional(), unitPrice: fields.unitPrice.optional(),
    costPrice: fields.costPrice.optional(), lowStockAt: fields.lowStockAt.optional(), metadata, source }).strict()
    .refine(value => Object.keys(value).some(key => !["clientId", "metadata", "source"].includes(key))),
  remove: z.object({ clientId: z.uuid(), metadata, source }).strict(),
  restock: z.object({ clientId: z.uuid(), quantity: positive, metadata, source }).strict(),
  count: z.object({ clientId: z.uuid(), countedQty: nonnegative, observedQty: quantity,
    reason: z.string().max(1000).default("Physical count"), metadata, source }).strict(),
  list: z.object({ q: z.string().max(200).optional(), includeDeleted: z.enum(["true", "false"]).default("false"),
    limit: z.coerce.number().int().min(1).max(5000).default(5000) }).strict(),
  changes: z.object({ since: z.string().regex(/^\d{1,19}$/).default("0").transform(value => BigInt(value))
    .refine(value => value <= 9223372036854775807n),
    limit: z.coerce.number().int().min(1).max(500).default(100) }).strict(),
  notifications: z.object({ unread: z.enum(["true", "false"]).default("true") }).strict(),
};
export type CreateProduct = z.infer<typeof inventorySchemas.create>;
export type UpdateProduct = z.infer<typeof inventorySchemas.update>;
