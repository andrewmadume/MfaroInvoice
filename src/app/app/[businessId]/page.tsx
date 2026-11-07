import { DashboardOverview } from "@/components/dashboard-overview";
import { allRows } from "@/lib/queries";
import { formatMoney } from "@/lib/finance";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

type ClientRelation = { name?: string } | { name?: string }[] | null;
function clientName(client: unknown) {
  const value = client as ClientRelation;
  return Array.isArray(value) ? value[0]?.name : value?.name;
}

export default async function BusinessDashboard({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const supabase = await createClient();
  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("currency_code,tax_name,default_tax_rate")
    .throwOnError()
    .eq("id", businessId)
    .single();
  if (businessError || !business)
    throw new Error("Unable to load business settings");
  const [invoices, clients, outstanding] = await Promise.all([
    supabase
      .from("invoices")
      .select("id,invoice_number,status,total,amount_paid,client:clients(name)")
      .throwOnError()
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(6),
    supabase
      .from("clients")
      .select("id", { count: "exact", head: true })
      .throwOnError()
      .eq("business_id", businessId),
    allRows((from, to) =>
      supabase
        .from("invoices")
        .select("total,amount_paid")
        .eq("business_id", businessId)
        .in("status", ["sent", "viewed", "partial", "overdue"])
        .order("id")
        .range(from, to),
    ),
  ]);
  const balance = outstanding.reduce(
    (sum, invoice) => sum + Number(invoice.total) - Number(invoice.amount_paid),
    0,
  );
  return (
    <DashboardOverview
      outstanding={formatMoney(balance, business.currency_code)}
      clientCount={clients.count ?? 0}
      invoices={(invoices.data ?? []).map((invoice) => ({
        id: invoice.id,
        number: invoice.invoice_number,
        client: clientName(invoice.client) || "—",
        status: invoice.status,
        total: formatMoney(Number(invoice.total), business.currency_code),
      }))}
      createInvoice={
        <Link className="button" href={`/app/${businessId}/invoices/new`}>
          Create invoice
        </Link>
      }
      viewAll={<Link href={`/app/${businessId}/invoices`}>View all</Link>}
      invoiceLink={(invoice) => (
        <Link href={`/app/${businessId}/invoices/${invoice.id}`}>
          {invoice.number}
        </Link>
      )}
    />
  );
}
