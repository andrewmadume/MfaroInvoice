import { InvoiceSettingsForm } from "@/components/invoice-settings-form";
import { businessBrand, businessLogoUrl } from "@/lib/invoice-brand";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";

export default async function SettingsPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { businessId } = await params;
  const { saved, error } = await searchParams;
  const supabase = await createClient();
  const { data: business } = await supabase.from("businesses").select("*").throwOnError().eq("id", businessId).maybeSingle();
  if (!business) notFound();
  const brand = businessBrand(business);
  return <section className="workspace"><div className="page-title"><div><p className="eyebrow">BUSINESS & INVOICE DESIGN</p><h1>Make it your own.</h1><p>Choose a template, add your details and preview your invoice.</p></div></div>{saved && <p className="success" role="status">Business profile and invoice design saved.</p>}{error && <p className="alert" role="alert">{error === "logo" ? "Use a valid PNG, JPEG or WebP logo under 2 MB and 16 megapixels." : error === "logo-upload" ? "The logo could not be uploaded. Please try again." : "Settings could not be saved. Check the invoice format and required fields, and make sure you can manage business settings."}</p>}<InvoiceSettingsForm business={{ ...brand, id: business.id, invoicePrefix: business.invoice_prefix, numberFormat: business.invoice_number_format, numberDigits: business.invoice_number_digits, countryCode: business.country_code || "ZA", defaultTaxRate: Number(business.default_tax_rate), currency: business.currency_code }} logoUrl={businessLogoUrl(businessId, brand.design.logoPath)} previewDate={new Date().toISOString().slice(0,10)} /></section>;
}
