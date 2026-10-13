import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const routeSchema = z.object({ businessId: z.string().uuid(), kind: z.enum(["invoices", "payments", "statement"]) });
const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const csv = (headers: string[], rows: unknown[][]) => [headers, ...rows].map((row) => row.map(quote).join(",")).join("\r\n");

export async function GET(request: NextRequest, { params }: { params: Promise<{ businessId: string; kind: string }> }) {
  const parsed = routeSchema.safeParse(await params); if (!parsed.success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const clientId = request.nextUrl.searchParams.get("clientId"); let content: string; let filename: string;
  if (parsed.data.kind === "payments") { const { data, error } = await supabase.from("payments").select("id,invoice_id,amount,currency_code,paid_at,provider_reference").eq("business_id", parsed.data.businessId).order("paid_at", { ascending: false }); if (error) return NextResponse.json({ error: "Forbidden" }, { status: 403 }); content = csv(["Payment ID", "Invoice ID", "Amount", "Currency", "Paid at", "Reference"], (data ?? []).map((row) => [row.id, row.invoice_id, row.amount, row.currency_code, row.paid_at, row.provider_reference])); filename = "payments.csv"; }
  else { let query = supabase.from("invoices").select("invoice_number,issue_date,due_date,status,total,amount_paid,client:clients(name)").eq("business_id", parsed.data.businessId).order("issue_date", { ascending: false }); if (parsed.data.kind === "statement") { if (!z.string().uuid().safeParse(clientId).success) return NextResponse.json({ error: "Client required" }, { status: 400 }); query = query.eq("client_id", clientId!); } const { data, error } = await query; if (error) return NextResponse.json({ error: "Forbidden" }, { status: 403 }); content = csv(["Invoice", "Client", "Issue date", "Due date", "Status", "Total", "Amount paid", "Balance"], (data ?? []).map((row) => { const client = row.client as unknown as { name?: string } | { name?: string }[] | null; const name = Array.isArray(client) ? client[0]?.name : client?.name; return [row.invoice_number, name, row.issue_date, row.due_date, row.status, row.total, row.amount_paid, Number(row.total) - Number(row.amount_paid)]; })); filename = parsed.data.kind === "statement" ? "client-statement.csv" : "invoices.csv"; }
  return new NextResponse(content, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "no-store" } });
}
