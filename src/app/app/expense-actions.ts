"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { expenseSchema, expenseFileInfo, expenseStatus, maxExpenseFileBytes, validExpenseHeader } from "@/lib/expenses";

export async function registerExpense(formData: FormData): Promise<{ error?: string; id?: string }> {
  const parsed = expenseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Check the supplier, date, amount and invoice details." };
  const p = parsed.data;
  if (!new RegExp(`^${p.businessId}/[0-9a-f-]{36}\\.(pdf|png|jpg|webp)$`).test(p.storagePath)) return { error: "The uploaded invoice could not be identified." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your session has expired. Sign in again before uploading." };
  const { data: file, error: downloadError } = await supabase.storage.from("expense-invoices").download(p.storagePath);
  if (downloadError || !file || !file.size || file.size > maxExpenseFileBytes) return { error: "The upload could not be verified. Please try again." };
  const info = expenseFileInfo(p.filename, file.type);
  if (!info || !validExpenseHeader(new Uint8Array(await file.slice(0,12).arrayBuffer()), info.type)) return { error: "Use a valid PDF, PNG, JPG or WebP invoice." };
  const { data, error } = await supabase.rpc("register_expense", {
    p_business_id: p.businessId, p_supplier: p.supplier, p_expense_date: p.expenseDate, p_category: p.category,
    p_description: p.description, p_amount: p.amount, p_currency: p.currency, p_status: p.status,
    p_invoice_reference: p.invoiceReference, p_storage_path: p.storagePath, p_original_filename: p.filename,
  });
  if (error || !data) return { error: "The expense could not be saved. Check the amount's currency precision and your business access, then retry." };
  revalidatePath(`/app/${p.businessId}/expenses`);
  return { id: String(data) };
}

export async function updateExpenseStatus(formData: FormData) {
  const parsed = z.object({ businessId: z.string().uuid(), expenseId: z.string().uuid(), status: expenseStatus }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/app");
  const p = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_expense_status", { p_business_id: p.businessId, p_expense_id: p.expenseId, p_status: p.status });
  if (error) redirect(`/app/${p.businessId}/expenses?error=status`);
  revalidatePath(`/app/${p.businessId}/expenses`);
}
