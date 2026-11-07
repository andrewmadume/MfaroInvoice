import { formatMoney, financialStatuses } from "../lib/finance";
import { totals, type LocalRecord, type Line } from "./model";
import type { OverviewInvoice } from "../components/dashboard-overview";

export function savedOverview(rows: LocalRecord[], currency: string) {
  const active = rows.filter((row) => !row.deleted);
  const invoices = active.filter((row) => row.kind === "invoices");
  const balances = new Map<string, number>();
  for (const row of invoices) {
    if (!financialStatuses.includes(String(row.data.status))) continue;
    const code = String(row.data.currency_code || currency);
    const balance = Math.max(
      0,
      Number(row.data.total || 0) - Number(row.data.amount_paid || 0),
    );
    if (balance) balances.set(code, (balances.get(code) || 0) + balance);
  }
  const recent: OverviewInvoice[] = [...invoices]
    .sort(
      (a, b) =>
        Number(b.state !== "Synced") - Number(a.state !== "Synced") ||
        String(b.data.created_at || "").localeCompare(
          String(a.data.created_at || ""),
        ) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 6)
    .map((row) => {
      const code = String(row.data.currency_code || currency);
      let total = Number(row.data.total || 0);
      if (!row.data.invoice_number) {
        try {
          total = totals(row.data.items as Line[], code).total;
        } catch {
          total = 0;
        }
      }
      return {
        id: row.id,
        number: String(
          row.data.invoice_number || `Offline draft ${row.id.slice(0, 8)}`,
        ),
        client: String(
          active.find(
            (client) =>
              client.kind === "clients" && client.id === row.data.client_id,
          )?.data.name || "—",
        ),
        status: String(row.data.status || "draft"),
        total: formatMoney(total, code),
      };
    });
  return {
    outstanding: balances.size
      ? [...balances]
          .map(([code, value]) => formatMoney(value, code))
          .join(" · ")
      : formatMoney(0, currency),
    clientCount: active.filter((row) => row.kind === "clients").length,
    invoices: recent,
  };
}
