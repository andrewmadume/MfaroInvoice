import { z } from "zod";

export const invoiceTemplates = [
  { id: "classic", name: "Mfaro Classic", description: "A blue-led business header, clear billing details and a structured totals panel." },
  { id: "minimal", name: "Mfaro Minimal", description: "A quiet, spacious layout with a slim brand accent and simple headings." },
] as const;
export const templateId = z.enum(["classic", "minimal"]);
const text = (max: number) => z.string().trim().max(max).default("");
export const numberFormat = z.string().max(80).refine(value => {
  const rest = value.replace(/\{(prefix|year|month|number)\}/g, "");
  return /^[A-Za-z0-9 /_-]*$/.test(rest) && (value.match(/\{number\}/g)?.length === 1);
}, "Include {number} once. Use {prefix}, {year}, {month}, letters, digits, spaces, /, _ or -.");
export const designSchema = z.object({
  template: templateId.default("classic"),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#1155cc"),
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#ffffff"),
  bankName: text(160), accountName: text(160), accountNumber: text(80),
  branchCode: text(80), accountType: text(80), swiftCode: text(80),
  paymentInstructions: text(2000), terms: text(2000), footer: text(240),
  website: text(200), logoPath: text(200),
});
export type InvoiceDesign = z.infer<typeof designSchema>;
export const defaultDesign = designSchema.parse({});
export type InvoiceBrand = {
  name: string; legalName?: string | null; email?: string | null; phone?: string | null;
  address?: string | null; taxNumber?: string | null; taxName?: string | null;
  design: InvoiceDesign;
};
export function readDesign(value: unknown): InvoiceDesign {
  const parsed = designSchema.safeParse(value);
  return parsed.success ? parsed.data : { ...defaultDesign };
}
export function contrastingText(hex: string) {
  const channels = hex.slice(1).match(/../g)?.map(c => parseInt(c, 16) / 255) ?? [1, 1, 1];
  const [r, g, b] = channels.map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  return .2126 * r + .7152 * g + .0722 * b > .179 ? "#172033" : "#ffffff";
}
export function previewInvoiceNumber(format: string, prefix: string, digits: number, sequence = 1, date = new Date()) {
  const tokens: Record<string, string> = { prefix, number: String(sequence).padStart(digits, "0"), year: String(date.getUTCFullYear()), month: String(date.getUTCMonth() + 1).padStart(2, "0") };
  return format.replace(/\{(prefix|year|month|number)\}/g, (_, token) => tokens[token]);
}
