import { z } from "zod";

export const expenseCategories = [
  ["materials", "Materials & supplies"], ["travel", "Travel & transport"], ["utilities", "Utilities"],
  ["rent", "Rent & premises"], ["software", "Software & subscriptions"], ["professional_services", "Professional services"], ["other", "Other"],
] as const;
export const expenseCategory = z.enum(["materials", "travel", "utilities", "rent", "software", "professional_services", "other"]);
export const expenseStatus = z.enum(["paid", "unpaid"]);
export const expenseSchema = z.object({
  businessId: z.string().uuid(), supplier: z.string().trim().min(1).max(160), expenseDate: z.string().date(),
  category: expenseCategory, description: z.string().trim().max(2000), amount: z.coerce.number().finite().positive().max(1_000_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/), status: expenseStatus, invoiceReference: z.string().trim().max(120),
  storagePath: z.string().max(200), filename: z.string().min(1).max(240).regex(/\.(pdf|png|jpe?g|webp)$/i),
});
export const maxExpenseFileBytes = 10_485_760;
export function expenseFileInfo(name: string, mime: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  const formats: Record<string, { type: string; extension: string }> = {
    pdf: { type: "application/pdf", extension: "pdf" }, png: { type: "image/png", extension: "png" },
    jpg: { type: "image/jpeg", extension: "jpg" }, jpeg: { type: "image/jpeg", extension: "jpg" }, webp: { type: "image/webp", extension: "webp" },
  };
  const info = formats[ext || ""];
  return info && (!mime || mime === info.type) ? info : null;
}
export function validExpenseHeader(bytes: Uint8Array, mime: string) {
  const start = (...values: number[]) => values.every((v,i) => bytes[i] === v);
  if (mime === "application/pdf") return start(37,80,68,70,45);
  if (mime === "image/png") return start(137,80,78,71,13,10,26,10);
  if (mime === "image/jpeg") return start(255,216,255);
  if (mime === "image/webp") return start(82,73,70,70) && [87,69,66,80].every((v,i) => bytes[i+8] === v);
  return false;
}
