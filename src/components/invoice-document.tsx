/* eslint-disable @next/next/no-img-element -- business logos use private signed URLs and local previews. */
import type { CSSProperties } from "react";
import { formatMoney } from "@/lib/finance";
import { contrastingText, type InvoiceBrand } from "@/lib/invoice-design";

export type InvoiceDocumentData = {
  number: string; status: string; issued: string; due: string | null; currency: string;
  subtotal: number; discount: number; tax: number; total: number; paid: number; notes?: string | null;
  client: { name?: string | null; email?: string | null; phone?: string | null; address?: string | null };
  items: { id: string; description: string; quantity: number; rate: number; taxRate: number; total: number }[];
};
export function InvoiceDocument({ brand, invoice, logoUrl }: { brand: InvoiceBrand; invoice: InvoiceDocumentData; logoUrl?: string | null }) {
  const { design } = brand;
  const money = (n: number) => formatMoney(n, invoice.currency);
  const style = { "--invoice-accent": design.accent, "--invoice-accent-text": contrastingText(design.accent), "--invoice-background": design.background, "--invoice-ink": contrastingText(design.background) } as CSSProperties;
  return <article className={`invoice-paper invoice-template invoice-${design.template}`} style={style} aria-label={`${design.template === "classic" ? "Mfaro Classic" : "Mfaro Minimal"} invoice`}>
    <header className="invoice-heading"><div className="invoice-identity">{logoUrl && <img className="business-invoice-logo" src={logoUrl} alt={`${brand.name} logo`} />}<div><h2>{brand.name}</h2>{brand.legalName && brand.legalName !== brand.name && <p>{brand.legalName}</p>}<p className="preserve-lines">{brand.address}</p><p>{[brand.email, brand.phone].filter(Boolean).join(" · ")}</p>{design.website && <p>{design.website}</p>}{brand.taxNumber && <p>{brand.taxName || "Tax"} registration: {brand.taxNumber}</p>}</div></div><div className="invoice-heading-label"><h3>INVOICE</h3><strong>{invoice.number}</strong><span className="invoice-status">{invoice.status}</span></div></header>
    <div className="invoice-parties"><section><h4>Bill to</h4><strong>{invoice.client.name}</strong><p className="preserve-lines">{invoice.client.address}</p><p>{invoice.client.email}</p><p>{invoice.client.phone}</p></section><dl><div><dt>Invoice date</dt><dd>{invoice.issued}</dd></div><div><dt>Due date</dt><dd>{invoice.due || "On receipt"}</dd></div><div><dt>Currency</dt><dd>{invoice.currency}</dd></div></dl></div>
    <div className="invoice-items-wrap"><table className="invoice-items"><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>{brand.taxName || "Tax"} %</th><th className="align-right">Amount</th></tr></thead><tbody>{invoice.items.map(item => <tr key={item.id}><td className="preserve-lines">{item.description}</td><td>{item.quantity}</td><td>{money(item.rate)}</td><td>{item.taxRate}%</td><td className="align-right">{money(item.total)}</td></tr>)}</tbody></table></div>
    <div className="invoice-bottom"><section className="invoice-payment"><h4>Payment details</h4>{design.bankName && <p><b>Bank:</b> {design.bankName}</p>}{design.accountName && <p><b>Account name:</b> {design.accountName}</p>}{design.accountNumber && <p><b>Account number:</b> {design.accountNumber}</p>}{design.branchCode && <p><b>Branch / routing code:</b> {design.branchCode}</p>}{design.accountType && <p><b>Account type:</b> {design.accountType}</p>}{design.swiftCode && <p><b>SWIFT / BIC:</b> {design.swiftCode}</p>}<p><b>Payment reference:</b> {invoice.number}</p>{design.paymentInstructions && <p className="preserve-lines">{design.paymentInstructions}</p>}</section><dl className="invoice-summary"><div><dt>Subtotal</dt><dd>{money(invoice.subtotal)}</dd></div>{invoice.discount > 0 && <div><dt>Discount</dt><dd>−{money(invoice.discount)}</dd></div>}<div><dt>{brand.taxName || "Tax"}</dt><dd>{money(invoice.tax)}</dd></div><div className="invoice-grand-total"><dt>Total</dt><dd>{money(invoice.total)}</dd></div><div><dt>Amount paid</dt><dd>{money(invoice.paid)}</dd></div><div className="invoice-balance"><dt>Balance due</dt><dd>{money(Math.max(0, invoice.total - invoice.paid))}</dd></div></dl></div>
    {(invoice.notes || design.terms) && <section className="invoice-terms">{invoice.notes && <><h4>Notes</h4><p className="preserve-lines">{invoice.notes}</p></>}{design.terms && <><h4>Terms and conditions</h4><p className="preserve-lines">{design.terms}</p></>}</section>}
    <div className="invoice-signatures"><span>Company signature</span><span>Client signature</span></div>{design.footer && <p className="invoice-footer">{design.footer}</p>}
  </article>;
}
