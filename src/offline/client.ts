import { createBrowserClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { meta, setMeta, mergeSnapshot } from "./storage";
import { syncQueue } from "./sync";
import type { Kind, RecordData } from "./model";
import { credentialStorage, desktopStorageKey } from "./platform";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
export const cloud = window.mfaroDesktop
  ? createClient(url, key, {
      auth: {
        detectSessionInUrl: false,
        storageKey: desktopStorageKey,
        storage: credentialStorage(window.mfaroDesktop.credentials),
      },
    })
  : createBrowserClient(url, key);
export type Business = RecordData & {
  id: string;
  name: string;
  currency_code: string;
  cachedLogos?: Record<string, string>;
};
export type Identity = { id: string; email: string };
export async function identity(): Promise<Identity | undefined> {
  if (!navigator.onLine) return meta<Identity>("identity");
  const { data, error } = await cloud.auth.getUser();
  if (error) {
    if (error.status && error.status < 500) return undefined;
    return meta<Identity>("identity");
  }
  if (!data.user) return undefined;
  const user = { id: data.user.id, email: data.user.email || "" };
  await setMeta("identity", user);
  return user;
}
export async function businesses(account: string): Promise<Business[]> {
  if (!navigator.onLine)
    return (await meta<Business[]>(`businesses:${account}`)) || [];
  const { data, error } = await cloud
    .from("businesses")
    .select("*")
    .order("name");
  if (error) throw error;
  const previous = (await meta<Business[]>(`businesses:${account}`)) || [];
  const list = (data as Business[]).map((b) => ({
    ...b,
    cachedLogos: previous.find((p) => p.id === b.id)?.cachedLogos,
  }));
  await setMeta(`businesses:${account}`, list);
  return list;
}
export async function download(account: string, business: string) {
  const incoming: { kind: Kind; data: RecordData }[] = [];
  // Fetch complete pages before reconciliation. A failed page never deletes cached data.
  for (const kind of ["clients", "products", "invoices"] as Kind[]) {
    for (let offset = 0; ; offset += 200) {
      const { data, error } = await cloud
        .from(kind)
        .select(kind === "invoices" ? "*, invoice_items(*)" : "*")
        .eq("business_id", business)
        .order("id")
        .range(offset, offset + 199);
      if (error) throw error;
      for (const raw of data as unknown as RecordData[]) {
        const row = { ...raw };
        if (kind === "invoices") {
          row.items = (row.invoice_items as RecordData[]).map((i) => ({
            description: i.description,
            quantity: Number(i.quantity),
            unitPrice: Number(i.unit_price),
            discountAmount: Number(i.discount_amount),
            taxRate: Number(i.tax_rate),
          }));
          row.template =
            (row.brand_snapshot as { invoice_design?: { template?: string } })
              ?.invoice_design?.template || "classic";
          delete row.invoice_items;
        }
        incoming.push({ kind, data: row });
      }
      if (data.length < 200) break;
    }
  }
  await mergeSnapshot(account, business, incoming);
  const list = (await meta<Business[]>(`businesses:${account}`)) || [],
    company = list.find((b) => b.id === business);
  if (company) {
    const paths = new Set<string>();
    const add = (value: unknown) => {
      const path = (value as { logoPath?: string })?.logoPath;
      if (path?.startsWith(business + "/")) paths.add(path);
    };
    add(company.invoice_design);
    for (const item of incoming)
      if (item.kind === "invoices")
        add((item.data.brand_snapshot as RecordData)?.invoice_design);
    const cachedLogos = { ...company.cachedLogos };
    for (const path of paths) {
      if (cachedLogos[path]) continue;
      const { data: blob, error } = await cloud.storage
        .from("business-logos")
        .download(path);
      if (error || !blob || blob.size > 2097152) continue;
      cachedLogos[path] = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    }
    company.cachedLogos = cachedLogos;
    await setMeta(`businesses:${account}`, list);
  }
}
export async function synchronize(account: string, business: string) {
  const {
    data: { user },
    error,
  } = await cloud.auth.getUser();
  if (error || user?.id !== account)
    throw new Error(
      "Sign in to this account again to sync. Drafts remain on this device.",
    );
  await syncQueue(account, business, async (op) => {
    const { data, error } = await cloud.rpc("apply_offline_change", {
      p_business_id: business,
      p_operation_id: op.id,
      p_kind: op.kind,
      p_record_id: op.recordId,
      p_version: op.version,
      p_deleted: op.deleted,
      p_data: op.data,
    });
    if (error)
      throw new Error(
        error.code === "42501"
          ? "Access denied. Check your session and business permissions."
          : error.message,
      );
    return data;
  });
}
