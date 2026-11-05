import { z } from "zod";
import Decimal from "decimal.js";
import { currencyDecimals } from "../lib/finance";

const decimal = z.coerce
  .number()
  .finite()
  .min(0)
  .max(1e9)
  .refine(
    (n) => new Decimal(n).decimalPlaces() <= 4,
    "Use at most four decimal places",
  );
export const lineSchema = z
  .object({
    description: z.string().trim().min(1).max(500),
    quantity: decimal.refine((n) => n > 0 && n <= 1e6),
    unitPrice: decimal,
    discountAmount: decimal,
    taxRate: decimal.refine((n) => n <= 100),
  })
  .refine(
    (i) =>
      new Decimal(i.quantity)
        .times(i.unitPrice)
        .toDecimalPlaces(4)
        .gte(i.discountAmount),
    "Discount exceeds line subtotal",
  );
export const customerSchema = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.union([z.literal(""), z.string().email().max(254)]),
  phone: z.string().max(60),
});
export const productSchema = z.object({
  name: z.string().trim().min(1).max(160),
  unit_price: decimal,
  tax_rate: decimal.refine((n) => n <= 100),
});
export const draftSchema = z.object({
  client_id: z.string().uuid(),
  due_date: z.union([z.literal(""), z.string().date()]),
  notes: z.string().max(2000),
  template: z.enum(["classic", "minimal", "letterhead"]),
  items: z.array(lineSchema).min(1).max(100),
});
export type Line = z.infer<typeof lineSchema>;
export type Kind = "clients" | "products" | "invoices";
export type State =
  | "Saved on this device"
  | "Pending sync"
  | "Synced"
  | "Sync failed"
  | "Conflict";
export type RecordData = Record<string, unknown>;
export type LocalRecord = {
  key: string;
  account: string;
  business: string;
  kind: Kind;
  id: string;
  version: number;
  data: RecordData;
  state: State;
  deleted?: boolean;
  server?: RecordData | null;
  error?: string;
};
export type Operation = {
  id: string;
  key: string;
  account: string;
  business: string;
  kind: Kind;
  recordId: string;
  version: number;
  data: RecordData;
  deleted: boolean;
  attempts: number;
  nextAttempt: number;
  state: State;
};
export function recordKey(
  account: string,
  business: string,
  kind: Kind,
  id: string,
) {
  return JSON.stringify([account, business, kind, id]);
}
export function validateData(kind: Kind, data: unknown) {
  const d = data && typeof data === "object" ? (data as RecordData) : {};
  const normalized =
    kind === "clients"
      ? { ...d, email: d.email ?? "", phone: d.phone ?? "" }
      : kind === "invoices"
        ? {
            ...d,
            due_date: d.due_date ?? "",
            notes: d.notes ?? "",
            template: d.template ?? "classic",
          }
        : d;
  return (
    kind === "clients"
      ? customerSchema
      : kind === "products"
        ? productSchema
        : draftSchema
  ).parse(normalized) as RecordData;
}
export function totals(items: Line[], currency: string) {
  let subtotal = new Decimal(0),
    discount = new Decimal(0),
    tax = new Decimal(0);
  const lines = items.map((raw) => {
    const i = lineSchema.parse(raw);
    const base = new Decimal(i.quantity)
      .times(i.unitPrice)
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    const t = base
      .minus(i.discountAmount)
      .times(i.taxRate)
      .div(100)
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    subtotal = subtotal.plus(base);
    discount = discount.plus(i.discountAmount);
    tax = tax.plus(t);
    return base.minus(i.discountAmount).plus(t).toNumber();
  });
  return {
    subtotal: subtotal.toNumber(),
    discount: discount.toNumber(),
    tax: tax.toNumber(),
    total: subtotal
      .minus(discount)
      .plus(tax)
      .toDecimalPlaces(currencyDecimals(currency), Decimal.ROUND_HALF_UP)
      .toNumber(),
    lines,
  };
}
export function retryDelay(attempts: number) {
  return Math.min(300000, 1000 * 2 ** Math.min(attempts, 9));
}
