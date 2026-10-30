export const financialStatuses = ["sent", "viewed", "partial", "overdue", "paid"];
export function currencyDecimals(currency: string) {
  if (["BIF","CLP","DJF","GNF","JPY","KMF","KRW","PYG","RWF","UGX","VND","VUV","XAF","XOF","XPF"].includes(currency)) return 0;
  if (["BHD","IQD","JOD","KWD","LYD","OMR","TND"].includes(currency)) return 3;
  return 2;
}
export function formatMoney(value: number | string, currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency, currencyDisplay: "code", minimumFractionDigits: currencyDecimals(currency), maximumFractionDigits: currencyDecimals(currency) }).format(Number(value));
}
export function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (typeof value === "string" && /^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
