import { createQuote } from "@/app/app/actions";
import { FinancialDocumentForm } from "@/components/financial-document-form";
import { createClient } from "@/lib/supabase/server";

export default async function NewQuotePage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { businessId } = await params; const { error } = await searchParams; const supabase = await createClient(); const { data: clients } = await supabase.from("clients").select("id,name").eq("business_id", businessId).order("name");
  return <section className="workspace"><div className="page-title"><div><p className="eyebrow">NEW QUOTE</p><h1>Prepare a quote</h1></div></div>{error && <p role="alert" className="alert">The quote could not be created. Verify the line items and client.</p>}<section className="form-card wide"><FinancialDocumentForm businessId={businessId} clients={clients ?? []} action={createQuote} submitLabel="Create quote" dateLabel="Expiry date" /></section></section>;
}
