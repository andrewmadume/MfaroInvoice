import { createInvoice } from "@/app/app/actions";
import { FinancialDocumentForm } from "@/components/financial-document-form";
import { createClient } from "@/lib/supabase/server";

export default async function NewInvoicePage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { businessId } = await params; const { error } = await searchParams; const supabase = await createClient(); const { data: business, error: businessError } = await supabase.from("businesses").select("currency_code,tax_name,default_tax_rate").throwOnError().eq("id", businessId).single(); if (businessError || !business) throw new Error("Unable to load business settings"); const { data: clients } = await supabase.from("clients").select("id,name").throwOnError().eq("business_id", businessId).order("name");
  return <section className="workspace"><div className="page-title"><div><p className="eyebrow">NEW INVOICE</p><h1>Create invoice</h1></div></div>{error && <p role="alert" className="alert">The invoice could not be created. Verify the line items and client.</p>}<section className="form-card wide"><FinancialDocumentForm currency={business.currency_code} taxName={business.tax_name} defaultTaxRate={Number(business.default_tax_rate)} businessId={businessId} clients={clients ?? []} action={createInvoice} submitLabel="Create draft invoice" dateLabel="Due date" /></section></section>;
}
