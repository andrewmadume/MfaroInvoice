// Deploy as a scheduled Supabase Edge Function. Configure RESEND_API_KEY and REMINDER_FROM server-side.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async () => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: reminders, error } = await supabase.from("invoice_reminders").select("id,invoice:invoices(invoice_number,due_date,total,amount_paid,client:clients(name,email)),business:businesses(name)").eq("status", "pending").lte("scheduled_for", new Date().toISOString()).limit(100);
  if (error) return new Response("Unable to load reminders", { status: 500 });
  for (const reminder of reminders ?? []) {
    const invoice = Array.isArray(reminder.invoice) ? reminder.invoice[0] : reminder.invoice; const client = invoice && (Array.isArray(invoice.client) ? invoice.client[0] : invoice.client);
    if (!client?.email) { await supabase.from("invoice_reminders").update({ status: "failed", attempt_count: 1 }).eq("id", reminder.id); continue; }
    const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: Deno.env.get("REMINDER_FROM"), to: [client.email], subject: `Payment reminder: ${invoice.invoice_number}`, text: `Hello ${client.name}, your invoice ${invoice.invoice_number} has an outstanding balance of ${Number(invoice.total) - Number(invoice.amount_paid)}. Due date: ${invoice.due_date ?? "on receipt"}.` }) });
    await supabase.from("invoice_reminders").update(response.ok ? { status: "sent", sent_at: new Date().toISOString(), attempt_count: 1 } : { status: "failed", attempt_count: 1 }).eq("id", reminder.id);
  }
  return Response.json({ processed: reminders?.length ?? 0 });
});
