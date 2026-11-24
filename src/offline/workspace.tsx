/* eslint-disable @next/next/no-img-element -- this shared renderer also runs without Next.js. */
import { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import { z } from "zod";
import { InvoiceDocument } from "../components/invoice-document";
import { businessBrand } from "../lib/invoice-brand";
import { invoiceTemplates, readDesign } from "../lib/invoice-design";
import { formatMoney } from "../lib/finance";
import {
  totals,
  validateData,
  type Kind,
  type Line,
  type LocalRecord,
  type RecordData,
  type Operation,
} from "./model";
import {
  all,
  records,
  recoveries,
  setMeta,
  saveLocal,
  enqueue,
  operations,
  clearAccount,
  resolveConflict,
  transaction,
} from "./storage";
import {
  cloud,
  identity,
  businesses,
  download,
  synchronize,
  type Identity,
  type Business,
} from "./client";
import { platform } from "./platform";
import { ApplicationNavigation } from "../components/application-navigation";
import { DashboardOverview } from "../components/dashboard-overview";
import { businessNavigation } from "../lib/business-navigation";
import { savedOverview } from "./overview";
import { RegisterServiceWorker } from "../components/register-service-worker";
import "../app/globals.css";
import "../app/phase3.css";
import "../app/branding.css";
import "../app/invoice-templates.css";
import "./workspace.css";

const newLine = (taxRate = 0): Line => ({
  description: "",
  quantity: 1,
  unitPrice: 0,
  discountAmount: 0,
  taxRate,
});
function Editor({
  row,
  rows,
  business,
  saved,
  close,
}: {
  row: LocalRecord;
  rows: LocalRecord[];
  business: Business;
  saved: () => void;
  close: () => void;
}) {
  const [data, setData] = useState<RecordData>(row.data),
    [message, setMessage] = useState(""),
    [dirty, setDirty] = useState(false);
  const saveRevision = useRef(0);
  const readOnly =
    ["Pending sync", "Sync failed", "Conflict"].includes(row.state) ||
    (row.kind === "invoices" && row.version > 0 && row.data.status !== "draft");
  function change(patch: RecordData) {
    setMessage("Saving edits on this device…");
    saveRevision.current++;
    setData((d) => ({ ...d, ...patch }));
    setDirty(true);
    window.mfaroDirty = true;
  }
  // Every edit is persisted; invalid/incomplete fields remain in the recovery buffer.
  useEffect(() => {
    if (!dirty) return;
    const revision = saveRevision.current;
    const timer = setTimeout(() => {
      void transaction<void>(["meta", "records"], (t) => {
        t.objectStore("meta").put({
          id: `recovery:${row.key}`,
          value: { row, data },
        });
        const store = t.objectStore("records"),
          request = store.get(row.key);
        request.onsuccess = () => {
          const current = request.result as LocalRecord | undefined;
          if (current?.state === "Synced" && current.version === row.version)
            store.put({ ...current, state: "Saved on this device" });
        };
      })
        .then(() => {
          if (revision === saveRevision.current) window.mfaroDirty = false;
          setMessage("Editing saved on this device. Save draft when ready.");
        })
        .catch(() => {
          setMessage(
            "Device storage failed. Keep this window open and export a backup.",
          );
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [data, dirty, row]);
  async function save() {
    setMessage("Saving…");
    try {
      await saveLocal(
        row.account,
        row.business,
        row.kind,
        row.id,
        data,
        false,
        row.version,
      );
      await transaction<void>(["meta"], (t) => {
        t.objectStore("meta").delete(`recovery:${row.key}`);
      });
      setDirty(false);
      window.mfaroDirty = false;
      setMessage("Saved on this device");
      saved();
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Could not save. Resolve any pending sync first.",
      );
    }
  }
  const items = (data.items || []) as Line[];
  let sums: ReturnType<typeof totals> | undefined;
  try {
    if (row.kind === "invoices")
      sums = totals(
        items,
        String(data.currency_code || business.currency_code),
      );
  } catch {
    /* Validation feedback on save. */
  }
  const field = (key: string, label: string, type = "text") => (
    <label>
      {label}
      <input
        type={type}
        value={String(data[key] ?? "")}
        onChange={(e) =>
          change({
            [key]:
              type === "number"
                ? e.target.value === ""
                  ? ""
                  : Number(e.target.value)
                : e.target.value,
          })
        }
        step={type === "number" ? "0.0001" : undefined}
      />
    </label>
  );
  return (
    <section className="offline-editor">
      <div className="offline-toolbar">
        <h2>
          {row.kind === "invoices"
            ? String(
                data.invoice_number || `Offline draft ${row.id.slice(0, 8)}`,
              )
            : String(data.name || "New record")}
        </h2>
        <button
          onClick={() => {
            if (window.mfaroDirty) {
              setMessage("Wait for the device save to finish before closing.");
              return;
            }
            if (
              !dirty ||
              confirm(
                "Close editor? Your edits are saved in recovery on this device.",
              )
            ) {
              window.mfaroDirty = false;
              close();
            }
          }}
        >
          Close
        </button>
      </div>
      <p role="status">{message || row.state}</p>
      {readOnly && (
        <p className="notice">
          {row.state === "Synced"
            ? "Issued invoice: viewing only."
            : "Sync or resolve this record before editing again."}
        </p>
      )}
      <fieldset disabled={readOnly}>
        {row.kind === "clients" && (
          <>
            {field("name", "Customer name")}
            {field("email", "Email", "email")}
            {field("phone", "Phone")}
          </>
        )}
        {row.kind === "products" && (
          <>
            {field("name", "Product / service name")}
            {field("unit_price", "Unit price", "number")}
            {field("tax_rate", "Tax %", "number")}
          </>
        )}
        {row.kind === "invoices" && (
          <>
            <label>
              Customer
              <select
                aria-label="Customer"
                value={String(data.client_id || "")}
                onChange={(e) => change({ client_id: e.target.value })}
              >
                <option value="">Choose customer</option>
                {rows
                  .filter((r) => r.kind === "clients" && !r.deleted)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {String(r.data.name)}
                    </option>
                  ))}
              </select>
            </label>
            {field("due_date", "Due date", "date")}
            <label>
              Template
              <select
                aria-label="Template"
                value={String(data.template || "classic")}
                onChange={(e) => change({ template: e.target.value })}
              >
                {invoiceTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Add product or service
              <select
                aria-label="Add product or service"
                value=""
                onChange={(e) => {
                  const product = rows.find(
                    (r) => r.kind === "products" && r.id === e.target.value,
                  );
                  if (product)
                    change({
                      items: [
                        ...items,
                        {
                          description: product.data.name,
                          quantity: 1,
                          unitPrice: Number(product.data.unit_price),
                          taxRate: Number(product.data.tax_rate),
                          discountAmount: 0,
                        },
                      ],
                    });
                }}
              >
                <option value="">Choose product</option>
                {rows
                  .filter((r) => r.kind === "products" && !r.deleted)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {String(r.data.name)}
                    </option>
                  ))}
              </select>
            </label>
            {items.map((item, index) => (
              <div className="offline-line" key={index}>
                {(
                  [
                    ["description", "Description"],
                    ["quantity", "Quantity"],
                    ["unitPrice", "Unit price"],
                    ["discountAmount", "Discount amount"],
                    ["taxRate", "Tax %"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      type={key === "description" ? "text" : "number"}
                      step="0.0001"
                      value={item[key]}
                      onChange={(e) =>
                        change({
                          items: items.map((i, n) =>
                            n === index
                              ? {
                                  ...i,
                                  [key]:
                                    key === "description"
                                      ? e.target.value
                                      : e.target.value === ""
                                        ? ""
                                        : Number(e.target.value),
                                }
                              : i,
                          ),
                        })
                      }
                    />
                  </label>
                ))}
                <button
                  onClick={() =>
                    change({ items: items.filter((_, n) => n !== index) })
                  }
                >
                  Remove line {index + 1}
                </button>
              </div>
            ))}
            <button
              onClick={() =>
                change({
                  items: [
                    ...items,
                    newLine(Number(business.default_tax_rate || 0)),
                  ],
                })
              }
            >
              Add line
            </button>
            <label>
              Notes
              <textarea
                value={String(data.notes || "")}
                onChange={(e) => change({ notes: e.target.value })}
              />
            </label>
          </>
        )}
        <button className="button" onClick={() => void save()}>
          Save {row.kind === "invoices" ? "draft" : "record"} on this device
        </button>
      </fieldset>
      {row.kind === "invoices" && sums && (
        <>
          <div className="offline-toolbar">
            <button
              onClick={() =>
                void platform.print().catch((e) => setMessage(String(e)))
              }
            >
              Print
            </button>
            <button
              onClick={() =>
                void platform.pdf().catch((e) => setMessage(String(e)))
              }
            >
              Export PDF
            </button>
          </div>
          <div className="offline-print">
            <InvoiceDocument
              logoUrl={
                business.cachedLogos?.[
                  businessBrand(business, data.brand_snapshot).design.logoPath
                ]
              }
              brand={{
                ...businessBrand(business, data.brand_snapshot),
                design: {
                  ...businessBrand(business, data.brand_snapshot).design,
                  template: (data.template || "classic") as "classic",
                },
              }}
              invoice={{
                number: String(
                  data.invoice_number || `OFFLINE DRAFT ${row.id.slice(0, 8)}`,
                ),
                status: String(data.status || "draft — not issued"),
                issued: String(
                  data.issue_date || new Date().toISOString().slice(0, 10),
                ),
                due: String(data.due_date || ""),
                currency: String(data.currency_code || business.currency_code),
                ...sums,
                paid: Number(data.amount_paid || 0),
                notes: String(data.notes || ""),
                client: (rows.find(
                  (r) => r.kind === "clients" && r.id === data.client_id,
                )?.data || {}) as { name?: string },
                items: items.map((i, n) => ({
                  id: String(n),
                  description: i.description,
                  quantity: i.quantity,
                  rate: i.unitPrice,
                  taxRate: i.taxRate,
                  total: sums!.lines[n],
                })),
              }}
            />
          </div>
        </>
      )}
    </section>
  );
}

function Workspace() {
  const [user, setUser] = useState<Identity>(),
    [companies, setCompanies] = useState<Business[]>([]),
    [business, setBusiness] = useState(""),
    [rows, setRows] = useState<LocalRecord[]>([]),
    [kind, setKind] = useState<Kind>("invoices"),
    [view, setView] = useState<"overview" | Kind | "sync">("overview"),
    [editing, setEditing] = useState<LocalRecord>(),
    [message, setMessage] = useState("Opening device workspace…"),
    [online, setOnline] = useState(navigator.onLine),
    [busy, setBusy] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [otp, setOtp] = useState("");
  const company = companies.find((b) => b.id === business);
  async function reload() {
    if (user && business) {
      const saved = await records(user.id, business),
        recovery = await recoveries(user.id, business);
      setRows([
        ...saved,
        ...recovery
          .filter((m) => !saved.some((r) => r.key === m.value.row.key))
          .map((m) => ({ ...m.value.row, data: m.value.data })),
      ]);
    }
  }
  useEffect(() => {
    let live = true;
    const init = async () => {
      const u = await identity();
      if (!live) return;
      setUser(u);
      if (u) {
        const list = await businesses(u.id);
        if (!live) return;
        setCompanies(list);
        setBusiness(list[0]?.id || "");
        setMessage(
          "Your business overview is ready. Refresh records in Device & sync before working offline.",
        );
      } else setMessage("Sign in online before using this device offline.");
    };
    void init().catch((e) => setMessage(String(e)));
    const update = () => setOnline(navigator.onLine);
    const unload = (e: BeforeUnloadEvent) => {
      if (window.mfaroDirty) e.preventDefault();
    };
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    window.addEventListener("beforeunload", unload);
    return () => {
      live = false;
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      window.removeEventListener("beforeunload", unload);
    };
  }, []);
  useEffect(() => {
    const {
      data: { subscription },
    } = cloud.auth.onAuthStateChange((event, session) => {
      if (
        event === "SIGNED_OUT" ||
        (user && session && session.user.id !== user.id)
      ) {
        void setMeta("identity", null);
        setUser(undefined);
        setRows([]);
        setEditing(undefined);
        setCompanies([]);
      }
    });
    return () => subscription.unsubscribe();
  }, [user]);
  useEffect(() => {
    if (!user || !business) return;
    let live = true,
      running = false;
    const run = async () => {
      if (running) return;
      running = true;
      try {
        if (navigator.onLine) await synchronize(user.id, business);
        if (live) setRows(await records(user.id, business));
      } catch (e) {
        if (live) setMessage(String(e));
      } finally {
        running = false;
      }
    };
    void run();
    const timer = setInterval(() => void run(), 15000);
    window.addEventListener("online", run);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("online", run);
    };
  }, [user, business, online]);
  async function action(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await work();
      await reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function open(row: LocalRecord) {
    if (window.mfaroDirty)
      throw new Error(
        "Wait for your latest edits to finish saving on this device.",
      );
    const recovery = (
      await all<{ id: string; value: RecordData }>("meta")
    ).find((m) => m.id === `recovery:${row.key}`);
    setEditing(
      recovery &&
        !["Pending sync", "Sync failed", "Conflict"].includes(row.state)
        ? {
            ...(recovery.value as unknown as { row: LocalRecord }).row,
            data: (recovery.value as unknown as { data: RecordData }).data,
          }
        : row,
    );
  }
  async function backup() {
    if (window.mfaroDirty)
      throw new Error(
        "Wait for your latest edits to finish saving before exporting a backup.",
      );
    if (!user) return;
    const payload = {
      format: "mfaro-backup",
      version: 1,
      account: user.id,
      business,
      records: await records(user.id, business),
      queue: await operations(user.id, business),
      recovery: (await all<{ id: string; value: unknown }>("meta")).filter(
        (m) =>
          m.id.startsWith("recovery:") &&
          m.id.includes(user.id) &&
          m.id.includes(business),
      ),
    };
    const complete = await platform.exportBackup(JSON.stringify(payload));
    if (!complete) return;
    setMessage(
      "Backup exported. It contains unencrypted financial data; keep it private.",
    );
  }
  async function restore() {
    if (!user) return;
    const text = await platform.importBackup();
    if (!text) return;
    const schema = z.object({
      format: z.literal("mfaro-backup"),
      version: z.literal(1),
      account: z.string().uuid(),
      business: z.string().uuid(),
      records: z.array(z.unknown()).max(50000),
      queue: z.array(z.unknown()).max(50000),
      recovery: z
        .array(z.object({ id: z.string(), value: z.unknown() }))
        .default([]),
    });
    const b = schema.parse(JSON.parse(text));
    if (b.account !== user.id || b.business !== business)
      throw new Error(
        "Choose the same account and organisation as this backup.",
      );
    if (
      (await records(user.id, business)).length ||
      (await operations(user.id, business)).length
    )
      throw new Error(
        "Restore requires an empty local workspace to avoid overwriting work. Use a fresh device profile.",
      );
    const validRecords = b.records.map((raw) => {
      const r = raw as LocalRecord;
      if (
        r.account !== user.id ||
        r.business !== business ||
        !["clients", "products", "invoices"].includes(r.kind) ||
        !z.string().uuid().safeParse(r.id).success ||
        r.key !== JSON.stringify([r.account, r.business, r.kind, r.id]) ||
        !Number.isSafeInteger(r.version) ||
        r.version < 0
      )
        throw new Error("Invalid backup record");
      if (!b.recovery.some((m) => m.id === `recovery:${r.key}`))
        validateData(r.kind, r.data);
      return r;
    });
    const validQueue = b.queue.map((raw) => {
      const o = raw as Operation;
      const r = validRecords.find((r) => r.key === o.key);
      if (
        !r ||
        o.account !== user.id ||
        o.business !== business ||
        o.kind !== r.kind ||
        o.recordId !== r.id ||
        !z.string().uuid().safeParse(o.id).success ||
        !Number.isSafeInteger(o.version) ||
        o.version < 0
      )
        throw new Error("Invalid backup queue");
      validateData(o.kind, o.data);
      return { ...o, nextAttempt: 0 };
    });
    await transaction<void>(["records", "queue", "meta"], (t) => {
      validRecords.forEach((r) => t.objectStore("records").put(r));
      validQueue.forEach((o) => t.objectStore("queue").put(o));
      b.recovery.forEach((r) => {
        if (validRecords.some((v) => r.id === `recovery:${v.key}`))
          t.objectStore("meta").put(r);
      });
    });
    setMessage(
      "Backup restored. Pending changes will retry with their original operation IDs.",
    );
  }
  function navigate(next: "overview" | Kind | "sync") {
    if (window.mfaroDirty) {
      setMessage("Wait for your latest edits to finish saving on this device.");
      return;
    }
    setEditing(undefined);
    setView(next);
    if (next !== "overview" && next !== "sync") setKind(next);
  }
  function newRecord(nextKind: Kind) {
    if (!user || !company) return;
    if (window.mfaroDirty) {
      alert("Wait for your latest edits to finish saving on this device.");
      return;
    }
    setKind(nextKind);
    setView(nextKind);
    const id = crypto.randomUUID();
    setEditing({
      key: JSON.stringify([user.id, business, nextKind, id]),
      account: user.id,
      business,
      kind: nextKind,
      id,
      version: 0,
      state: "Not saved",
      data:
        nextKind === "invoices"
          ? {
              client_id: "",
              due_date: "",
              notes: "",
              template: readDesign(company.invoice_design).template,
              items: [newLine(Number(company.default_tax_rate || 0))],
            }
          : nextKind === "clients"
            ? { name: "", email: "", phone: "" }
            : { name: "", unit_price: 0, tax_rate: 0 },
    });
  }
  const overview = company
    ? savedOverview(rows, company.currency_code)
    : undefined;
  const localViews: Record<string, "overview" | Kind | "sync"> = {
    "": "overview",
    "/invoices": "invoices",
    "/clients": "clients",
    "/inventory": "products",
    "/sync": "sync",
  };
  return (
    <div className="app-shell">
      <ApplicationNavigation
        name={company?.name || "MfaroInvoice"}
        brand={
          <button
            className="brand brand-logo desktop-brand"
            aria-label="MfaroInvoice overview"
            onClick={() => navigate("overview")}
          >
            <img
              className="brand-logo-image brand-logo-image-compact"
              src="/MfaroInvoice-logo.svg"
              alt="MfaroInvoice — Your Business. Your Invoices. Your Growth."
            />
          </button>
        }
        navigation={
          user && company ? (
            businessNavigation.map(([label, suffix]) => {
              const local = localViews[suffix];
              return (
                <button
                  type="button"
                  key={label}
                  aria-current={local === view ? "page" : undefined}
                  title={
                    local ? undefined : "Opens the online app in your browser"
                  }
                  onClick={() => {
                    if (local) {
                      navigate(local);
                      return;
                    }
                    void action(async () => {
                      if (window.mfaroDirty)
                        throw new Error(
                          "Save your latest edits before opening another page.",
                        );
                      if (!navigator.onLine)
                        throw new Error(
                          "Connect to the internet to open this page.",
                        );
                      await platform.external(
                        `https://mfaro-invoice.vercel.app/app/${encodeURIComponent(business)}${suffix}`,
                      );
                    });
                  }}
                >
                  {label}
                  {!local && (
                    <span
                      className="desktop-external"
                      aria-label="opens online"
                    >
                      ↗
                    </span>
                  )}
                </button>
              );
            })
          ) : (
            <button
              type="button"
              onClick={() =>
                void platform.external("https://mfaro-invoice.vercel.app/app")
              }
            >
              Open online app
            </button>
          )
        }
      />
      <main className="offline-workspace">
        <div className="desktop-session">
          <span className={online ? "connection online" : "connection offline"}>
            {online ? "Online" : "Offline"}
          </span>
          {user && <span>{user.email}</span>}
          <p role="status" aria-live="polite">
            {message}
          </p>
        </div>
        {!user ? (
          <section className="workspace desktop-sign-in">
            <h1>Sign in</h1>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(async () => {
                  if (!navigator.onLine) throw new Error("Connect to sign in");
                  const { error } = await cloud.auth.signInWithPassword({
                    email,
                    password,
                  });
                  setPassword("");
                  if (error) throw error;
                  const factors = await cloud.auth.mfa.listFactors();
                  const factor = factors.data?.totp.find(
                    (f) => f.status === "verified",
                  );
                  if (factor) {
                    if (!/^\d{6}$/.test(otp))
                      throw new Error(
                        "Enter your six-digit authenticator code, then sign in again.",
                      );
                    const verified = await cloud.auth.mfa.challengeAndVerify({
                      factorId: factor.id,
                      code: otp,
                    });
                    setOtp("");
                    if (verified.error) throw verified.error;
                  }
                  const u = await identity();
                  if (!u) throw new Error("Could not verify account");
                  const list = await businesses(u.id);
                  setUser(u);
                  setCompanies(list);
                  setBusiness(list[0]?.id || "");
                  setMessage(
                    "Signed in. Download your records for offline use.",
                  );
                });
              }}
            >
              <label>
                Email
                <input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <label>
                Authenticator code (if enabled)
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  maxLength={6}
                />
              </label>
              <button disabled={busy}>Sign in</button>
              <p>
                First-time sign-in requires internet. Use the online app for
                registration, MFA and account recovery.
              </p>
            </form>
          </section>
        ) : (
          <>
            <details
              className="device-tools"
              open={view === "sync" ? true : undefined}
            >
              <summary>Device &amp; sync</summary>
              <div className="offline-toolbar">
                <label>
                  Organisation
                  <select
                    value={business}
                    onChange={(e) => {
                      if (window.mfaroDirty) {
                        alert(
                          "Wait for your latest edits to finish saving on this device.",
                        );
                        return;
                      }
                      window.mfaroDirty = false;
                      setBusiness(e.target.value);
                      setRows([]);
                      setEditing(undefined);
                    }}
                  >
                    {companies.map((b) => (
                      <option value={b.id} key={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  disabled={busy || !online}
                  onClick={() =>
                    void action(async () => {
                      await synchronize(user.id, business);
                      await download(user.id, business);
                      setCompanies(await businesses(user.id));
                      setMessage(
                        "Records downloaded. Pending local work has been preserved.",
                      );
                    })
                  }
                >
                  Download / refresh records
                </button>
                <button
                  disabled={busy || !online}
                  onClick={() =>
                    void action(async () => {
                      await synchronize(user.id, business);
                      setMessage(
                        "Sync checked. Review each record’s state below.",
                      );
                    })
                  }
                >
                  Sync now
                </button>
                <button disabled={busy} onClick={() => void action(backup)}>
                  Export backup
                </button>
                <button disabled={busy} onClick={() => void action(restore)}>
                  Restore backup
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      if (
                        !confirm(
                          "Sign out and erase this account’s local records, pending changes and recovery edits? Export a backup first. Other devices and server records are unchanged.",
                        )
                      )
                        return;
                      setUser(undefined);
                      setRows([]);
                      setEditing(undefined);
                      window.mfaroDirty = false;
                      try {
                        await cloud.auth.signOut({ scope: "local" });
                      } finally {
                        await clearAccount(user.id);
                      }
                    })
                  }
                >
                  Sign out & erase local data
                </button>
              </div>
              <p className="notice">
                Records saved here are available to anyone using this device
                profile. Local financial records and backups are not encrypted.
                Issuing invoices and recording payments require the online app.
              </p>
            </details>
            {company && overview && view === "overview" && (
              <DashboardOverview
                {...overview}
                createInvoice={
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => newRecord("invoices")}
                  >
                    Create invoice
                  </button>
                }
                viewAll={
                  <button
                    className="text-button"
                    onClick={() => navigate("invoices")}
                  >
                    View all
                  </button>
                }
                invoiceLink={(invoice) => (
                  <button
                    className="text-button"
                    onClick={() =>
                      void action(async () => {
                        const row = rows.find(
                          (r) => r.kind === "invoices" && r.id === invoice.id,
                        );
                        if (!row) return;
                        await open(row);
                        setKind("invoices");
                        setView("invoices");
                      })
                    }
                  >
                    {invoice.number}
                  </button>
                )}
                notice={
                  <p className="dashboard-source">
                    Saved records on this device. Refresh records in Device
                    &amp; sync for the latest business figures.
                  </p>
                }
              />
            )}
            {company && view !== "overview" && view !== "sync" && (
              <section className="workspace desktop-records">
                <div className="page-title">
                  <div>
                    <p className="eyebrow">BUSINESS WORKSPACE</p>
                    <h1>
                      {kind === "clients"
                        ? "Clients"
                        : kind === "products"
                          ? "Inventory"
                          : "Invoices"}
                    </h1>
                  </div>
                </div>

                <button
                  disabled={busy}
                  className="button"
                  onClick={() => newRecord(kind)}
                >
                  New{" "}
                  {kind === "invoices"
                    ? "offline draft"
                    : kind === "clients"
                      ? "customer"
                      : "product / service"}
                </button>
                <ul className="offline-records">
                  {rows
                    .filter((r) => r.kind === kind)
                    .map((r) => (
                      <li key={r.key}>
                        <div>
                          <strong>
                            {String(
                              r.data.invoice_number ||
                                r.data.name ||
                                `Offline draft ${r.id.slice(0, 8)}`,
                            )}
                          </strong>
                          <p>
                            {r.state}
                            {r.deleted ? " · deletion pending" : ""}
                            {r.kind === "invoices" && r.data.total !== undefined
                              ? ` · ${formatMoney(Number(r.data.total), String(r.data.currency_code || company.currency_code))}`
                              : ""}
                          </p>
                          {r.error && <p role="alert">{r.error}</p>}
                        </div>
                        <div className="offline-toolbar">
                          <button onClick={() => void action(() => open(r))}>
                            Open
                          </button>
                          {r.state === "Saved on this device" && (
                            <button
                              disabled={busy}
                              onClick={() =>
                                void action(async () => {
                                  if (window.mfaroDirty)
                                    throw new Error(
                                      "Save your latest edits before queueing changes.",
                                    );
                                  await enqueue(r);
                                  setEditing(undefined);
                                  if (navigator.onLine)
                                    await synchronize(user.id, business);
                                  setMessage(
                                    "Change queued. Check its sync state.",
                                  );
                                })
                              }
                            >
                              Queue sync
                            </button>
                          )}
                          {r.state === "Conflict" && (
                            <>
                              <button
                                onClick={() =>
                                  void action(async () => {
                                    if (
                                      confirm(
                                        "Discard this local edit and use the server record?",
                                      )
                                    )
                                      await resolveConflict(r, true);
                                  })
                                }
                              >
                                Use server version
                              </button>
                              <button
                                disabled={
                                  !r.server ||
                                  (r.kind === "invoices" &&
                                    r.server.status !== "draft")
                                }
                                onClick={() =>
                                  void action(async () => {
                                    if (
                                      confirm(
                                        "Keep your local edit based on the latest version? Review it, then queue sync again.",
                                      )
                                    )
                                      await resolveConflict(r, false);
                                  })
                                }
                              >
                                Keep local edit
                              </button>
                              <details>
                                <summary>
                                  Compare server and local changes
                                </summary>
                                <pre>
                                  Local: {JSON.stringify(r.data, null, 2)}
                                  {"\n"}Server:{" "}
                                  {JSON.stringify(r.server, null, 2)}
                                </pre>
                              </details>
                            </>
                          )}
                          {["Saved on this device", "Synced"].includes(
                            r.state,
                          ) &&
                            !(
                              r.kind === "invoices" &&
                              r.version > 0 &&
                              r.data.status !== "draft"
                            ) && (
                              <button
                                disabled={busy}
                                onClick={() =>
                                  void action(async () => {
                                    if (
                                      !confirm(
                                        "Delete this record? Server references may prevent deletion. The deletion stays pending until confirmed by the server.",
                                      )
                                    )
                                      return;
                                    await saveLocal(
                                      r.account,
                                      r.business,
                                      r.kind,
                                      r.id,
                                      r.data,
                                      true,
                                      r.version,
                                    );
                                  })
                                }
                              >
                                Delete
                              </button>
                            )}
                        </div>
                      </li>
                    ))}
                </ul>
                {editing && (
                  <Editor
                    key={editing.key}
                    row={editing}
                    rows={rows}
                    business={company}
                    saved={() => void reload()}
                    close={() => setEditing(undefined)}
                  />
                )}
              </section>
            )}
          </>
        )}
        {(!user || view === "sync") && (
          <section className="workspace desktop-help">
            {!window.mfaroDesktop && (
              <details>
                <summary>Install MfaroInvoice</summary>
                <p>
                  Android / Chrome / Edge: choose Install app from the browser
                  menu. iPhone or iPad: open in Safari, tap Share → Add to Home
                  Screen. On supported macOS Safari choose File → Add to Dock.
                </p>
              </details>
            )}
            <p>
              Save your work and export a backup before installing a desktop
              update.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <>
    <RegisterServiceWorker />
    <Workspace />
  </>,
);
