import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import fs from "node:fs";
import ts from "typescript";
import "fake-indexeddb/auto";
const require = createRequire(import.meta.url);
require.extensions[".ts"] = (m, file) =>
  m._compile(
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    file,
  );
const {
  credentialStorage,
  desktopStorageKey,
} = require("../src/offline/platform.ts");
await test("desktop session storage does not alias Supabase migration or verifier keys", async () => {
  let secret = null;
  const storage = credentialStorage({
    get: async () => secret,
    set: async (value) => {
      secret = value;
    },
  });
  await storage.setItem(desktopStorageKey, "session");
  assert.equal(await storage.getItem(desktopStorageKey + "-user"), null);
  await storage.removeItem(desktopStorageKey + "-user");
  assert.equal(await storage.getItem(desktopStorageKey), "session");
  await storage.removeItem(desktopStorageKey);
  assert.equal(secret, null);
});
const store = require("../src/offline/storage.ts"),
  { syncQueue } = require("../src/offline/sync.ts"),
  model = require("../src/offline/model.ts");
const { savedOverview } = require("../src/offline/overview.ts");
await test("saved dashboard excludes drafts and deletions from outstanding and separates currencies", () => {
  const row = (id, kind, data) => ({
    id,
    kind,
    data,
    state: "Synced",
    account: "a",
    business: "b",
    key: id,
    version: 1,
  });
  const data = [
    row("client", "clients", { name: "Example" }),
    row("sent", "invoices", {
      client_id: "client",
      invoice_number: "INV-1",
      status: "sent",
      total: 115,
      amount_paid: 15,
      currency_code: "ZAR",
    }),
    row("dollars", "invoices", {
      invoice_number: "INV-2",
      status: "overdue",
      total: 20,
      amount_paid: 0,
      currency_code: "USD",
    }),
    row("draft", "invoices", { status: "draft", total: 999, amount_paid: 0 }),
    {
      ...row("deleted", "invoices", { status: "sent", total: 1000 }),
      deleted: true,
    },
  ];
  const summary = savedOverview(data, "ZAR");
  assert.equal(summary.clientCount, 1);
  assert.match(summary.outstanding, /ZAR\s*100\.00/);
  assert.match(summary.outstanding, /USD\s*20\.00/);
  assert.doesNotMatch(summary.outstanding, /999|1000/);
  assert.equal(summary.invoices.find((i) => i.id === "sent").client, "Example");
});
const {
  allowedSender,
  allowedExternal,
  assetPath,
} = require("../desktop/security.cjs");
const account = "11111111-1111-4111-8111-111111111111",
  business = "22222222-2222-4222-8222-222222222222";
await test("durable device storage, tenant separation, interrupted sync, backoff and conflicts", async () => {
  const id = crypto.randomUUID();
  await store.saveLocal(account, business, "clients", id, {
    name: "Customer",
    email: "",
    phone: "",
  });
  assert.equal(
    (await store.records(account, business))[0].data.name,
    "Customer",
  );
  assert.equal((await store.records("other", business)).length, 0);
  assert.equal((await store.records(account, "other")).length, 0);
  // Every operation opens/closes IDB: this read is after connection restart.
  let row = (await store.records(account, business))[0];
  await store.enqueue(row);
  await store.enqueue(row);
  assert.equal((await store.operations(account, business)).length, 1);
  await assert.rejects(
    store.saveLocal(account, business, "clients", id, {
      name: "Unsafe edit",
      email: "",
      phone: "",
    }),
  );
  let calls = 0;
  const receipts = new Map();
  const send = async (op) => {
    calls++;
    if (!receipts.has(op.id))
      receipts.set(op.id, {
        outcome: "ok",
        record: { id: op.recordId, ...op.data, offline_revision: 1 },
        version: 1,
      });
    if (calls === 1) throw new Error("Connection lost after server commit");
    return receipts.get(op.id);
  };
  await syncQueue(account, business, send, 100);
  assert.equal((await store.operations(account, business)).length, 1);
  await syncQueue(account, business, send, 101);
  assert.equal(calls, 1);
  await syncQueue(account, business, send, 100000);
  assert.equal(calls, 2);
  assert.equal(receipts.size, 1);
  assert.equal((await store.operations(account, business)).length, 0);
  row = (await store.records(account, business))[0];
  assert.equal(row.state, "Synced");
  await store.saveLocal(account, business, "clients", id, {
    name: "Local edit",
    email: "",
    phone: "",
  });
  await store.enqueue((await store.records(account, business))[0]);
  await syncQueue(account, business, async () => ({
    outcome: "conflict",
    record: {
      id,
      name: "Remote edit",
      email: "",
      phone: "",
      offline_revision: 2,
    },
    version: 2,
  }));
  row = (await store.records(account, business))[0];
  assert.equal(row.state, "Conflict");
  await store.mergeSnapshot(account, business, [
    {
      kind: "clients",
      data: {
        id,
        name: "Download must not overwrite conflict",
        offline_revision: 3,
      },
    },
  ]);
  assert.equal(
    (await store.records(account, business))[0].data.name,
    "Local edit",
  );
  await store.resolveConflict(row, false);
  row = (await store.records(account, business))[0];
  assert.equal(row.version, 2);
  assert.equal(row.state, "Saved on this device");
  await store.saveLocal("other", business, "clients", crypto.randomUUID(), {
    name: "Private B",
    email: "",
    phone: "",
  });
  await store.clearAccount(account);
  assert.equal((await store.records(account, business)).length, 0);
  assert.equal((await store.records("other", business)).length, 1);
});
await test("decimal calculations preserve PostgreSQL line and currency rounding", () => {
  assert.equal(
    model.totals(
      [
        {
          description: "Tax",
          quantity: 1,
          unitPrice: 0.1,
          discountAmount: 0,
          taxRate: 15,
        },
      ],
      "USD",
    ).total,
    0.12,
  );
  assert.equal(
    model.totals(
      [
        {
          description: "Discount",
          quantity: 3,
          unitPrice: 19.99,
          discountAmount: 2,
          taxRate: 15,
        },
      ],
      "ZAR",
    ).total,
    66.67,
  );
  assert.throws(() =>
    model.totals(
      [
        {
          description: "Invalid",
          quantity: 1,
          unitPrice: 10,
          discountAmount: 11,
          taxRate: 15,
        },
      ],
      "USD",
    ),
  );
  assert.throws(() =>
    model.validateData("products", {
      name: "Invalid",
      unit_price: Infinity,
      tax_rate: 0,
    }),
  );
});
await test("desktop URL and file boundaries reject unexpected origins, traversal and shell protocols", () => {
  assert.equal(allowedSender("mfaro://app/offline/"), true);
  assert.equal(
    allowedSender("https://mfaro-invoice.vercel.app/offline/"),
    false,
  );
  for (const u of [
    "file:///C:/secret",
    "javascript:alert(1)",
    "https://mfaro-invoice.vercel.app.evil.test",
    "https://user@mfaro-invoice.vercel.app/",
  ])
    assert.equal(allowedExternal(u), false);
  assert.equal(allowedExternal("https://mfaro-invoice.vercel.app/app"), true);
  assert.equal(assetPath("mfaro://app/%2e%2e/secret", "C:\\app\\public"), null);
  assert.equal(
    assetPath("mfaro://app/offline/config.json", "C:\\app\\public"),
    null,
  );
  const main = fs.readFileSync("desktop/main.cjs", "utf8"),
    preload = fs.readFileSync("desktop/preload.cjs", "utf8");
  for (const setting of [
    /contextIsolation:\s*true/,
    /nodeIntegration:\s*false/,
    /sandbox:\s*true/,
  ])
    assert.match(main, setting);
  assert.match(main, /event.senderFrame !== win.webContents.mainFrame/);
  assert.doesNotMatch(
    preload,
    /exposeInMainWorld\(['"](?:ipcRenderer|require)/,
  );
});
await test("manifest, branded PNG dimensions, shell assets and service worker cache boundaries", () => {
  const manifest = JSON.parse(
    fs.readFileSync("public/manifest.webmanifest", "utf8"),
  );
  assert.equal(manifest.id, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.start_url, "/offline/index.html");
  for (const icon of manifest.icons) {
    const png = fs.readFileSync("public" + icon.src);
    const [width, height] = icon.sizes.split("x").map(Number);
    assert.equal(png.readUInt32BE(16), width);
    assert.equal(png.readUInt32BE(20), height);
  }
  assert.ok(manifest.icons.some((i) => i.purpose === "maskable"));
  const sw = fs.readFileSync("scripts/service-worker.js", "utf8");
  assert.doesNotMatch(sw, /cache\.put/);
  assert.match(sw, /ACTIVATE_UPDATE/);
  assert.match(sw, /offline\/index.html/);
});
