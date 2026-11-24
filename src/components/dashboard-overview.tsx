import type { ReactNode } from "react";

export type OverviewInvoice = {
  id: string;
  number: string;
  client: string;
  status: string;
  total: string;
};
export function DashboardOverview({
  outstanding,
  clientCount,
  invoices,
  createInvoice,
  viewAll,
  invoiceLink,
  notice,
}: {
  outstanding: string;
  clientCount: number;
  invoices: OverviewInvoice[];
  createInvoice: ReactNode;
  viewAll: ReactNode;
  invoiceLink: (invoice: OverviewInvoice) => ReactNode;
  notice?: ReactNode;
}) {
  return (
    <section className="workspace dashboard-overview">
      <div className="page-title">
        <div>
          <p className="eyebrow">BUSINESS OVERVIEW</p>
          <h1>Know what’s next.</h1>
        </div>
        {createInvoice}
      </div>
      {notice}
      <div className="stat-grid">
        <article>
          <span>Outstanding</span>
          <strong>{outstanding}</strong>
        </article>
        <article>
          <span>Clients</span>
          <strong>{clientCount}</strong>
        </article>
        <article>
          <span>Recent invoices</span>
          <strong>{invoices.length}</strong>
        </article>
      </div>
      <section className="table-card">
        <div className="card-title">
          <h2>Recent invoices</h2>
          {viewAll}
        </div>
        {invoices.length ? (
          <table>
            <thead>
              <tr>
                <th>Number</th>
                <th>Client</th>
                <th>Status</th>
                <th className="align-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td>{invoiceLink(invoice)}</td>
                  <td>{invoice.client}</td>
                  <td>
                    <span className={`badge ${invoice.status}`}>
                      {invoice.status}
                    </span>
                  </td>
                  <td className="align-right">{invoice.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="empty-state">Your invoice activity will appear here.</p>
        )}
      </section>
    </section>
  );
}
