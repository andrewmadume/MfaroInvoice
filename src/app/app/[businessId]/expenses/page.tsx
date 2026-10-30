import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/finance";
import { expenseCategories, expenseCategory, expenseStatus } from "@/lib/expenses";
import { ExpenseUpload, ExpenseStatusButton } from "@/components/expense-upload";
import { updateExpenseStatus } from "@/app/app/expense-actions";

type Filters = { q?: string; category?: string; status?: string; page?: string; error?: string };
type Totals = { currency_code:string; total:number; paid:number; unpaid:number };
export default async function ExpensesPage({ params, searchParams }: { params:Promise<{businessId:string}>; searchParams:Promise<Filters> }) {
  const { businessId } = await params;
  const filter = await searchParams;
  const query = typeof filter.q === "string" ? filter.q.replace(/[%_\\*]/g, "").trim().slice(0,100) : "";
  const category = expenseCategory.safeParse(filter.category).data || "";
  const status = expenseStatus.safeParse(filter.status).data || "";
  const page = Math.min(100000,Math.max(1,Number.parseInt(filter.page || "1",10) || 1));
  const pageSize = 20;
  const supabase = await createClient();
  const [{data:business},{data:{user}},{data:canCreate},{data:canRead},{data:canUpdate}] = await Promise.all([
    supabase.from("businesses").select("currency_code").eq("id",businessId).maybeSingle(),supabase.auth.getUser(),
    supabase.rpc("has_permission",{target_business:businessId,required_permission:"expenses.create"}),
    supabase.rpc("has_permission",{target_business:businessId,required_permission:"expenses.read"}),
    supabase.rpc("has_permission",{target_business:businessId,required_permission:"expenses.update"}),
  ]);
  if (!business || !user) notFound();
  if (!canCreate && !canRead) return <section className="workspace"><h1>Expenses</h1><p>You do not have access to expenses for this business. Ask a business administrator for access.</p></section>;
  let request = supabase.from("expenses").select("id,supplier,expense_date,category,description,amount,currency_code,payment_status,invoice_reference,original_filename,created_by",{count:"exact"}).eq("business_id",businessId);
  if (query) request = request.ilike("supplier",`%${query}%`);
  if (category) request = request.eq("category",category);
  if (status) request = request.eq("payment_status",status);
  const [{data:expenses,count},{data:summary}] = await Promise.all([
    request.order("expense_date",{ascending:false}).order("created_at",{ascending:false}).order("id").range((page-1)*pageSize,page*pageSize-1).throwOnError(),
    supabase.rpc("expense_summary",{p_business_id:businessId,p_query:query,p_category:category,p_status:status}).throwOnError(),
  ]);
  const totals: Totals[] = Array.isArray(summary?.totals) ? summary.totals : [];
  const href = (target:number) => { const values = new URLSearchParams(); if(query)values.set("q",query);if(category)values.set("category",category);if(status)values.set("status",status);values.set("page",String(target));return `/app/${businessId}/expenses?${values}`; };
  return <section className="workspace expenses-workspace"><div className="page-title"><div><p className="eyebrow">BUSINESS COSTS</p><h1>Expenses</h1><p className="expenses-intro">Keep every cost, supplier invoice and receipt in one place.</p></div>{canCreate && <a className="button" href="#upload-expense">+ Add expense</a>}</div>
    {filter.error && <p className="alert" role="alert">The payment status could not be updated. Check your business access and try again.</p>}
    <div className="expense-overview"><article><span>Matching expenses</span><strong>{Number(summary?.count || 0)}</strong><small>{canRead ? "Business expense records" : "Your uploaded expenses"}</small></article><article><span>Total costs</span>{totals.length ? totals.map(t=><strong key={t.currency_code}>{formatMoney(Number(t.total),t.currency_code)}</strong>) : <strong>{formatMoney(0,business.currency_code)}</strong>}<small>All matching paid and unpaid costs</small></article><article><span>Still to pay</span>{totals.length ? totals.map(t=><strong key={t.currency_code}>{formatMoney(Number(t.unpaid),t.currency_code)}</strong>) : <strong>{formatMoney(0,business.currency_code)}</strong>}<small>Unpaid supplier invoices</small></article></div>
    <div className={`expense-layout${canCreate ? "" : " expense-read-only"}`}>{canCreate && <section className="form-card expense-upload-card" id="upload-expense"><p className="eyebrow">UPLOAD & RECORD</p><h2>Add an expense</h2><p>Attach the invoice, then enter its details.</p><ExpenseUpload businessId={businessId} currency={business.currency_code} today={new Date().toISOString().slice(0,10)} /></section>}
    <section className="table-card expense-records"><div className="card-title"><div><h2>Expense records</h2><p>{canRead ? "Supplier invoices and receipts for your business." : "Only your own uploaded expenses are shown."}</p></div><span className="expense-private-label">Private files</span></div><form className="expense-filters" method="get"><label>Search supplier<input name="q" defaultValue={query} placeholder="Supplier name" maxLength={100} /></label><label>Category<select name="category" defaultValue={category}><option value="">All categories</option>{expenseCategories.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><label>Payment<select name="status" defaultValue={status}><option value="">All payments</option><option value="paid">Paid</option><option value="unpaid">Unpaid</option></select></label><button className="button small">Filter</button>{(query || category || status) && <Link href={`/app/${businessId}/expenses`}>Clear</Link>}</form>
    {expenses?.length ? <><div className="expense-table-scroll"><table><thead><tr><th>Supplier / invoice</th><th>Date</th><th>Category</th><th className="align-right">Amount</th><th>Payment</th><th>File</th></tr></thead><tbody>{expenses.map(e=><tr key={e.id}><td><strong>{e.supplier}</strong>{e.invoice_reference && <span className="expense-reference">{e.invoice_reference}</span>}{e.description && <span className="expense-description" title={e.description}>{e.description}</span>}</td><td>{e.expense_date}</td><td>{expenseCategories.find(([id])=>id===e.category)?.[1] || e.category}</td><td className="align-right expense-amount">{formatMoney(Number(e.amount),e.currency_code)}</td><td><span className={`expense-payment-badge ${e.payment_status}`}>{e.payment_status}</span>{(canUpdate || e.created_by===user.id) && <form action={updateExpenseStatus}><input type="hidden" name="businessId" value={businessId} /><input type="hidden" name="expenseId" value={e.id} /><input type="hidden" name="status" value={e.payment_status==='paid' ? 'unpaid' : 'paid'} /><ExpenseStatusButton paid={e.payment_status==='paid'} /></form>}</td><td><Link className="text-button" href={`/api/businesses/${businessId}/expenses/${e.id}/file`} title={e.original_filename}>Download invoice</Link></td></tr>)}</tbody></table></div><nav className="expense-pagination" aria-label="Expense pages"><span>{(page-1)*pageSize+1}–{Math.min(page*pageSize,count || 0)} of {count || 0}</span><div>{page>1 && <Link href={href(page-1)}>← Previous</Link>}{page*pageSize<(count || 0) && <Link href={href(page+1)}>Next →</Link>}</div></nav></> : <div className="expense-empty"><span aria-hidden="true">▤</span><h3>{query || category || status ? "No matching expenses" : "Your expenses start here"}</h3><p>{query || category || status ? "Try another supplier, category or payment filter." : "Upload your first supplier invoice or receipt to begin tracking business costs."}</p>{page>1 && <Link href={href(1)}>Return to the first page</Link>}</div>}
    <p className="expense-help">Totals include all records matching your filters. Different currencies are kept separate.</p></section></div>
  </section>;
}
