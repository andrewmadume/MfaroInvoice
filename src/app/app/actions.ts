"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const uuid = z.string().uuid();
const itemSchema = z.object({ description: z.string().trim().min(1).max(500), quantity: z.coerce.number().positive().max(1_000_000), unitPrice: z.coerce.number().min(0).max(1_000_000_000), discountAmount: z.coerce.number().min(0).max(1_000_000_000).default(0), taxRate: z.coerce.number().min(0).max(100).default(0) });
const itemsSchema = z.array(itemSchema).min(1).max(100);

function failure(path: string): never { redirect(`${path}${path.includes("?") ? "&" : "?"}error=action-failed`); }
function businessPath(businessId: string, suffix = "") { return `/app/${businessId}${suffix}`; }

export async function updateBusinessProfile(formData: FormData) {
  const parsed = z.object({ businessId: uuid, name: z.string().trim().min(2).max(160), legalName: z.string().trim().max(160), email: z.union([z.literal(""), z.string().trim().email().max(254)]), phone: z.string().trim().max(60), address: z.string().trim().max(1_000), taxNumber: z.string().trim().max(120), invoicePrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,12}$/) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) failure("/app");
  const supabase = await createClient();
  const { error } = await supabase.from("businesses").update({ name: parsed.data.name, legal_name: parsed.data.legalName || null, email: parsed.data.email || null, phone: parsed.data.phone || null, address: parsed.data.address || null, tax_number: parsed.data.taxNumber || null, invoice_prefix: parsed.data.invoicePrefix }).eq("id", parsed.data.businessId);
  if (error) failure(businessPath(parsed.data.businessId, "/settings"));
  revalidatePath(businessPath(parsed.data.businessId));
  redirect(businessPath(parsed.data.businessId, "/settings?saved=1"));
}

export async function createClientRecord(formData: FormData) {
  const parsed = z.object({ businessId: uuid, name: z.string().trim().min(2).max(160), email: z.union([z.literal(""), z.string().trim().email().max(254)]), phone: z.string().trim().max(60), taxNumber: z.string().trim().max(120) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) failure("/app");
  const supabase = await createClient();
  const { error } = await supabase.from("clients").insert({ business_id: parsed.data.businessId, name: parsed.data.name, email: parsed.data.email || null, phone: parsed.data.phone || null, tax_number: parsed.data.taxNumber || null });
  if (error) failure(businessPath(parsed.data.businessId, "/clients"));
  revalidatePath(businessPath(parsed.data.businessId, "/clients"));
  redirect(businessPath(parsed.data.businessId, "/clients?created=1"));
}

async function parseDocumentInput(formData: FormData) {
  const base = z.object({ businessId: uuid, clientId: uuid, dueDate: z.union([z.literal(""), z.string().date()]), notes: z.string().trim().max(4_000), itemsJson: z.string().min(2).max(100_000) }).safeParse(Object.fromEntries(formData));
  if (!base.success) return null;
  try { return { ...base.data, items: itemsSchema.parse(JSON.parse(base.data.itemsJson)) }; } catch { return null; }
}

export async function createInvoice(formData: FormData) {
  const parsed = await parseDocumentInput(formData);
  if (!parsed) failure("/app");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_invoice", { p_business_id: parsed.businessId, p_client_id: parsed.clientId, p_due_date: parsed.dueDate || null, p_notes: parsed.notes || null, p_items: parsed.items });
  if (error || !data) failure(businessPath(parsed.businessId, "/invoices/new"));
  revalidatePath(businessPath(parsed.businessId));
  redirect(businessPath(parsed.businessId, `/invoices/${data}`));
}

export async function createQuote(formData: FormData) {
  const parsed = await parseDocumentInput(formData);
  if (!parsed) failure("/app");
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_quote", { p_business_id: parsed.businessId, p_client_id: parsed.clientId, p_expiry_date: parsed.dueDate || null, p_notes: parsed.notes || null, p_items: parsed.items });
  if (error) failure(businessPath(parsed.businessId, "/quotes/new"));
  revalidatePath(businessPath(parsed.businessId, "/quotes"));
  redirect(businessPath(parsed.businessId, "/quotes?created=1"));
}

export async function convertQuote(formData: FormData) {
  const parsed = z.object({ businessId: uuid, quoteId: uuid, dueDate: z.union([z.literal(""), z.string().date()]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) failure("/app");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("convert_quote_to_invoice", { p_quote_id: parsed.data.quoteId, p_due_date: parsed.data.dueDate || null });
  if (error || !data) failure(businessPath(parsed.data.businessId, "/quotes"));
  revalidatePath(businessPath(parsed.data.businessId));
  redirect(businessPath(parsed.data.businessId, `/invoices/${data}`));
}

export async function sendInvoice(formData: FormData) {
  const parsed = z.object({ businessId: uuid, invoiceId: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) failure("/app");
  const supabase = await createClient();
  const { error } = await supabase.rpc("send_invoice", { p_invoice_id: parsed.data.invoiceId });
  if (error) failure(businessPath(parsed.data.businessId, `/invoices/${parsed.data.invoiceId}`));
  revalidatePath(businessPath(parsed.data.businessId, `/invoices/${parsed.data.invoiceId}`));
}

export async function recordPayment(formData: FormData) {
  const parsed = z.object({ businessId: uuid, invoiceId: uuid, amount: z.coerce.number().positive().max(1_000_000_000), paidAt: z.union([z.literal(""), z.string().datetime({ offset: true })]), reference: z.string().trim().max(160) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) failure("/app");
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_payment", { p_invoice_id: parsed.data.invoiceId, p_amount: parsed.data.amount, p_paid_at: parsed.data.paidAt || null, p_provider_reference: parsed.data.reference || null });
  if (error) failure(businessPath(parsed.data.businessId, `/invoices/${parsed.data.invoiceId}`));
  revalidatePath(businessPath(parsed.data.businessId));
  redirect(businessPath(parsed.data.businessId, `/invoices/${parsed.data.invoiceId}?payment=1`));
}

export async function createProduct(formData: FormData) {
  const parsed = z.object({ businessId: uuid, name: z.string().trim().min(2).max(160), sku: z.string().trim().max(80), unitPrice: z.coerce.number().min(0).max(1_000_000_000), taxRate: z.coerce.number().min(0).max(100), openingStock: z.coerce.number().min(0).max(1_000_000) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) failure("/app");
  const supabase = await createClient();
  const { data, error } = await supabase.from("products").insert({ business_id: parsed.data.businessId, name: parsed.data.name, sku: parsed.data.sku || null, unit_price: parsed.data.unitPrice, tax_rate: parsed.data.taxRate }).select("id").single();
  if (error || !data) failure(businessPath(parsed.data.businessId, "/inventory"));
  if (parsed.data.openingStock > 0) { const { error: adjustmentError } = await supabase.rpc("adjust_inventory", { p_business_id: parsed.data.businessId, p_product_id: data.id, p_quantity_delta: parsed.data.openingStock, p_reason: "opening_balance", p_note: "Opening balance" }); if (adjustmentError) failure(businessPath(parsed.data.businessId, "/inventory")); }
  revalidatePath(businessPath(parsed.data.businessId, "/inventory"));
  redirect(businessPath(parsed.data.businessId, "/inventory?created=1"));
}

export async function adjustInventory(formData: FormData) {
  const parsed = z.object({ businessId: uuid, productId: uuid, quantityDelta: z.coerce.number().refine((value) => value !== 0), reason: z.enum(["purchase", "sale", "adjustment", "return"]), note: z.string().trim().max(500) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) failure("/app");
  const supabase = await createClient();
  const { error } = await supabase.rpc("adjust_inventory", { p_business_id: parsed.data.businessId, p_product_id: parsed.data.productId, p_quantity_delta: parsed.data.quantityDelta, p_reason: parsed.data.reason, p_note: parsed.data.note || null });
  if (error) failure(businessPath(parsed.data.businessId, "/inventory"));
  revalidatePath(businessPath(parsed.data.businessId, "/inventory"));
}

export async function createProject(formData: FormData) {
  const parsed = z.object({ businessId: uuid, clientId: z.union([z.literal(""), uuid]), name: z.string().trim().min(2).max(160), hourlyRate: z.union([z.literal(""), z.coerce.number().min(0).max(1_000_000)]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) failure("/app");
  const supabase = await createClient();
  const { error } = await supabase.from("projects").insert({ business_id: parsed.data.businessId, client_id: parsed.data.clientId || null, name: parsed.data.name, hourly_rate: parsed.data.hourlyRate || null });
  if (error) failure(businessPath(parsed.data.businessId, "/time"));
  revalidatePath(businessPath(parsed.data.businessId, "/time"));
  redirect(businessPath(parsed.data.businessId, "/time?project=1"));
}

export async function createTimeEntry(formData: FormData) {
  const raw = Object.fromEntries(formData); raw.billable = formData.getAll("billable").includes("true") ? "true" : "false";
  const parsed = z.object({ businessId: uuid, projectId: uuid, entryDate: z.string().date(), minutes: z.coerce.number().int().min(1).max(1440), description: z.string().trim().min(1).max(500), billable: z.enum(["true", "false"]) }).safeParse(raw);
  if (!parsed.success) failure("/app");
  const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) redirect("/login");
  const { error } = await supabase.from("time_entries").insert({ business_id: parsed.data.businessId, project_id: parsed.data.projectId, user_id: user.id, entry_date: parsed.data.entryDate, minutes: parsed.data.minutes, description: parsed.data.description, billable: parsed.data.billable === "true" });
  if (error) failure(businessPath(parsed.data.businessId, "/time"));
  revalidatePath(businessPath(parsed.data.businessId, "/time"));
  redirect(businessPath(parsed.data.businessId, "/time?entry=1"));
}

export async function createRecurringInvoice(formData: FormData) {
  const document = await parseDocumentInput(formData); const recurring = z.object({ frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]), dueDays: z.coerce.number().int().min(0).max(365) }).safeParse(Object.fromEntries(formData));
  if (!document || !recurring.success) failure("/app");
  const supabase = await createClient(); const { error } = await supabase.rpc("create_recurring_invoice", { p_business_id: document.businessId, p_client_id: document.clientId, p_frequency: recurring.data.frequency, p_next_run_date: document.dueDate || new Date().toISOString().slice(0, 10), p_due_days: recurring.data.dueDays, p_notes: document.notes || null, p_items: document.items });
  if (error) failure(businessPath(document.businessId, "/recurring"));
  revalidatePath(businessPath(document.businessId, "/recurring"));
  redirect(businessPath(document.businessId, "/recurring?created=1"));
}

export async function runRecurringInvoice(formData: FormData) {
  const parsed = z.object({ businessId: uuid, recurringId: uuid }).safeParse(Object.fromEntries(formData)); if (!parsed.success) failure("/app");
  const supabase = await createClient(); const { data, error } = await supabase.rpc("run_recurring_invoice", { p_recurring_id: parsed.data.recurringId });
  if (error || !data) failure(businessPath(parsed.data.businessId, "/recurring"));
  revalidatePath(businessPath(parsed.data.businessId)); redirect(businessPath(parsed.data.businessId, `/invoices/${data}`));
}

export async function registerDocument(formData: FormData) {
  const parsed = z.object({ businessId: uuid, storagePath: z.string().min(38).max(1_000), filename: z.string().trim().regex(/\.(pdf|png|jpe?g|csv|xlsx)$/i), mimeType: z.enum(["application/pdf", "image/png", "image/jpeg", "text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]), sizeBytes: z.coerce.number().int().min(1).max(10_485_760) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success || !parsed.data.storagePath.startsWith(`${parsed.data.businessId}/`)) failure("/app");
  const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) redirect("/login");
  const { error } = await supabase.from("documents").insert({ business_id: parsed.data.businessId, storage_path: parsed.data.storagePath, original_filename: parsed.data.filename, mime_type: parsed.data.mimeType, size_bytes: parsed.data.sizeBytes, created_by: user.id });
  if (error) failure(businessPath(parsed.data.businessId, "/documents"));
  revalidatePath(businessPath(parsed.data.businessId, "/documents"));
  redirect(businessPath(parsed.data.businessId, "/documents?uploaded=1"));
}

export async function configurePaymentProvider(formData: FormData) {
  const parsed = z.object({ businessId: uuid, provider: z.enum(["paystack", "flutterwave", "manual"]), enabled: z.enum(["true", "false"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) failure("/app");
  const supabase = await createClient(); const { error } = await supabase.from("payment_provider_configs").upsert({ business_id: parsed.data.businessId, provider: parsed.data.provider, enabled: parsed.data.enabled === "true", public_config: {} }, { onConflict: "business_id,provider" });
  if (error) failure(businessPath(parsed.data.businessId, "/payments"));
  revalidatePath(businessPath(parsed.data.businessId, "/payments")); redirect(businessPath(parsed.data.businessId, "/payments?saved=1"));
}
