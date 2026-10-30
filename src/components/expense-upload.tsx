"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { registerExpense } from "@/app/app/expense-actions";
import { expenseCategories, expenseFileInfo, maxExpenseFileBytes, validExpenseHeader } from "@/lib/expenses";

export function ExpenseStatusButton({ paid }: { paid:boolean }) {
  const { pending } = useFormStatus();
  return <button className="expense-status-action" disabled={pending}>{pending ? "Saving…" : paid ? "Mark unpaid" : "Mark paid"}</button>;
}

export function ExpenseUpload({ businessId, currency, today }: { businessId: string; currency: string; today: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [stage, setStage] = useState("");
  const [selectedCurrency, setSelectedCurrency] = useState(currency);
  const [selectedName, setSelectedName] = useState("");
  const busy = useRef(false);
  const uploaded = useRef<{ path: string; signature: string } | null>(null);
  const currencies = [...new Set([currency,"ZAR","USD","EUR","GBP","ZWG","KES","NGN","GHS","UGX","TZS","ZMW","BWP","MZN"])] as string[];
  const digits = new Intl.NumberFormat("en", { style:"currency", currency:selectedCurrency }).resolvedOptions().maximumFractionDigits;
  return <form className="expense-upload-form" onSubmit={async event => {
    event.preventDefault();
    if (busy.current) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const file = values.get("file");
    setMessage(""); setSuccess(false);
    if (!(file instanceof File) || !file.size || file.size > maxExpenseFileBytes) { setMessage("Choose an invoice or receipt up to 10 MB."); return; }
    const info = expenseFileInfo(file.name, file.type);
    if (!info) { setMessage("Choose a valid PDF, PNG, JPG or WebP file."); return; }
    busy.current = true; setStage("Checking invoice…");
    try {
      if (!validExpenseHeader(new Uint8Array(await file.slice(0,12).arrayBuffer()), info.type)) { setMessage("Choose a valid PDF, PNG, JPG or WebP file."); return; }
      setStage("Uploading invoice…");
      const signature = `${file.name}:${file.size}:${file.lastModified}`;
      if (!uploaded.current || uploaded.current.signature !== signature) {
        const path = `${businessId}/${crypto.randomUUID()}.${info.extension}`;
        const { error } = await createClient().storage.from("expense-invoices").upload(path, file, { contentType:info.type, upsert:false });
        if (error) { setMessage("The file could not be uploaded. Check your connection and try again."); return; }
        uploaded.current = { path, signature };
      }
      setStage("Saving expense…");
      values.delete("file"); values.set("businessId",businessId); values.set("storagePath",uploaded.current.path); values.set("filename",file.name);
      const result = await registerExpense(values);
      if (result.error || !result.id) { setMessage(result.error || "The expense could not be saved. Please retry."); return; }
      form.reset(); uploaded.current = null; setSelectedName(""); setSelectedCurrency(currency);
      setSuccess(true); setMessage("Expense and invoice saved securely."); router.refresh();
    } catch { setMessage("The connection was interrupted. Retry to finish saving this expense."); }
    finally { busy.current = false; setStage(""); }
  }}>
    <fieldset disabled={!!stage}><label className="expense-file-zone"><span className="expense-file-icon" aria-hidden="true">↑</span><strong>{selectedName || "Choose an invoice or receipt"}</strong><span>PDF, PNG, JPG or WebP · up to 10 MB</span><input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" required disabled={!!stage} onChange={event => { uploaded.current = null; setSelectedName(event.target.files?.[0]?.name || ""); setMessage(""); }} /></label>
    <label>Supplier / vendor<input name="supplier" maxLength={160} required placeholder="Who was this expense paid to?" /></label>
    <div className="form-grid"><label>Invoice date<input name="expenseDate" type="date" defaultValue={today} required /></label><label>Category<select name="category" defaultValue="other">{expenseCategories.map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>Total amount (including tax)<input name="amount" type="number" min={10 ** -(digits ?? 2)} step={10 ** -(digits ?? 2)} max="1000000000" required placeholder="0.00" /></label><label>Currency<select name="currency" value={selectedCurrency} onChange={event => setSelectedCurrency(event.target.value)}>{currencies.map(code => <option key={code}>{code}</option>)}</select></label><label>Invoice / receipt number<input name="invoiceReference" maxLength={120} placeholder="Optional reference" /></label><label>Payment status<select name="status" defaultValue="paid"><option value="paid">Paid</option><option value="unpaid">Unpaid</option></select></label></div>
    <label>What was this expense for?<textarea name="description" rows={3} maxLength={2000} placeholder="Optional notes for your records" /></label>
    <p className="expense-help">Enter the details shown on the invoice. Your file is stored privately with this expense.</p></fieldset>
    <button className="button" disabled={!!stage}>{stage || "Save expense & invoice"}</button>
    {message && <p className={success ? "success" : "alert"} role={success ? "status" : "alert"}>{message}</p>}
  </form>;
}
