import { readDesign, type InvoiceBrand } from "@/lib/invoice-design";

export function businessBrand(business: Record<string, unknown>, snapshot?: unknown): InvoiceBrand {
  const value = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot as Record<string, unknown> : business;
  const string = (key: string) => typeof value[key] === "string" ? value[key] as string : "";
  return { name: string("name"), legalName: string("legal_name"), email: string("email"), phone: string("phone"), address: string("address"), taxNumber: string("tax_number"), taxName: string("tax_name"), design: readDesign(value.invoice_design) };
}
export function businessLogoUrl(businessId: string, path: string) {
  return path ? `/api/businesses/${businessId}/logo?path=${encodeURIComponent(path)}` : undefined;
}
