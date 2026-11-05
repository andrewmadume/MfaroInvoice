import {
  recordKey,
  validateData,
  type Kind,
  type LocalRecord,
  type Operation,
  type RecordData,
} from "./model";

// A distinct database leaves the existing time/stock operation queue intact.
export async function openStore() {
  return await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("mfaro-workspace", 1);
    r.onupgradeneeded = () => {
      for (const name of ["records", "queue", "meta"])
        r.result.createObjectStore(name, {
          keyPath: name === "records" ? "key" : "id",
        });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () =>
      reject(new Error("Close other Mfaro windows to upgrade storage."));
  });
}
export async function transaction<T>(
  names: string[],
  action: (t: IDBTransaction, result: (v: T) => void) => void,
  mode: IDBTransactionMode = "readwrite",
): Promise<T> {
  const db = await openStore();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(names, mode);
      let value: T;
      t.oncomplete = () => resolve(value);
      t.onabort = t.onerror = () =>
        reject(t.error || new Error("Device storage failed"));
      try {
        action(t, (v) => {
          value = v;
        });
      } catch (e) {
        t.abort();
        reject(e);
      }
    });
  } finally {
    db.close();
  }
}
export async function all<T>(store: string): Promise<T[]> {
  return transaction(
    [store],
    (t, done) => {
      const r = t.objectStore(store).getAll();
      r.onsuccess = () => done(r.result);
    },
    "readonly",
  );
}
export async function records(account: string, business: string) {
  const saved = (await all<LocalRecord>("records")).filter(
    (r) => r.account === account && r.business === business,
  );
  const recovery = await recoveries(account, business);
  return [
    ...saved,
    ...recovery
      .filter((m) => !saved.some((r) => r.key === m.value.row.key))
      .map((m) => ({ ...m.value.row, data: m.value.data })),
  ];
}
export async function recoveries(account: string, business: string) {
  return (
    await all<{ id: string; value: { row: LocalRecord; data: RecordData } }>(
      "meta",
    )
  ).filter(
    (m) =>
      m.id.startsWith("recovery:") &&
      m.value?.row?.account === account &&
      m.value.row.business === business,
  );
}
export async function operations(account: string, business: string) {
  return (await all<Operation>("queue")).filter(
    (r) => r.account === account && r.business === business,
  );
}
export async function meta<T>(id: string): Promise<T | undefined> {
  return transaction(
    ["meta"],
    (t, done) => {
      const r = t.objectStore("meta").get(id);
      r.onsuccess = () => done(r.result?.value);
    },
    "readonly",
  );
}
export async function setMeta(id: string, value: unknown) {
  return transaction<void>(["meta"], (t) => {
    t.objectStore("meta").put({ id, value });
  });
}

export async function saveLocal(
  account: string,
  business: string,
  kind: Kind,
  id: string,
  data: RecordData,
  deleted = false,
  expectedVersion?: number,
) {
  const valid = deleted ? data : validateData(kind, data),
    key = recordKey(account, business, kind, id);
  return transaction<void>(["records", "queue"], (t) => {
    const store = t.objectStore("records"),
      r = store.get(key);
    r.onsuccess = () => {
      const old = r.result as LocalRecord | undefined;
      if (
        expectedVersion !== undefined &&
        (old?.version || 0) !== expectedVersion
      ) {
        t.abort();
        return;
      }
      // Never replace the payload of an operation that may already have reached the server.
      const q = t.objectStore("queue").getAll();
      q.onsuccess = () => {
        if ((q.result as Operation[]).some((o) => o.key === key)) {
          t.abort();
          return;
        }
        if (deleted && !old?.version) {
          store.delete(key);
          return;
        }
        if (
          kind === "invoices" &&
          old &&
          old.data.status !== "draft" &&
          old.version > 0
        ) {
          t.abort();
          return;
        }
        store.put({
          ...old,
          key,
          account,
          business,
          kind,
          id,
          data: { ...old?.data, ...valid },
          version: old?.version || 0,
          deleted,
          state: "Saved on this device",
        });
      };
    };
  });
}
export async function enqueue(record: LocalRecord) {
  if (await meta(`recovery:${record.key}`))
    throw new Error(
      "Open and save your recovered edits before queueing this record.",
    );
  return transaction<void>(["records", "queue", "meta"], (t) => {
    const q = t.objectStore("queue"),
      r = q.getAll();
    r.onsuccess = () => {
      if ((r.result as Operation[]).some((o) => o.key === record.key)) return;
      const read = t.objectStore("records").get(record.key);
      read.onsuccess = () => {
        const current = read.result as LocalRecord | undefined;
        if (!current || current.state !== "Saved on this device") {
          t.abort();
          return;
        }
        try {
          q.put({
            id: crypto.randomUUID(),
            key: current.key,
            account: current.account,
            business: current.business,
            kind: current.kind,
            recordId: current.id,
            version: current.version,
            data: current.deleted
              ? {}
              : validateData(current.kind, current.data),
            deleted: !!current.deleted,
            attempts: 0,
            nextAttempt: 0,
            state: "Pending sync",
          } satisfies Operation);
          t.objectStore("records").put({ ...current, state: "Pending sync" });
          t.objectStore("meta").delete(`recovery:${current.key}`);
        } catch {
          t.abort();
        }
      };
    };
  });
}
export async function acknowledge(
  op: Operation,
  server: RecordData | null,
  version: number,
) {
  return transaction<void>(["records", "queue"], (t) => {
    const pending = t.objectStore("queue").get(op.id);
    pending.onsuccess = () => {
      if (!pending.result) return;
      t.objectStore("queue").delete(op.id);
      t.objectStore("records").delete(op.key);
      if (server) {
        const id = String(server.id);
        t.objectStore("records").put({
          key: recordKey(op.account, op.business, op.kind, id),
          account: op.account,
          business: op.business,
          kind: op.kind,
          id,
          data: server,
          version,
          state: "Synced",
        } satisfies LocalRecord);
      }
    };
  });
}
export async function fail(
  op: Operation,
  message: string,
  conflict: boolean,
  server?: RecordData | null,
) {
  return transaction<void>(["records", "queue"], (t) => {
    const pending = t.objectStore("queue").get(op.id);
    pending.onsuccess = () => {
      if (!pending.result) return;
      t.objectStore("queue").put(op);
      const s = t.objectStore("records"),
        r = s.get(op.key);
      r.onsuccess = () => {
        if (r.result)
          s.put({
            ...r.result,
            state: conflict ? "Conflict" : "Sync failed",
            error: message,
            server,
          });
      };
    };
  });
}
export async function mergeSnapshot(
  account: string,
  business: string,
  incoming: { kind: Kind; data: RecordData }[],
) {
  return transaction<void>(["records"], (t) => {
    const s = t.objectStore("records"),
      r = s.getAll();
    r.onsuccess = () => {
      // A complete download reconciles server deletions, but never deletes pending local work.
      for (const old of r.result as LocalRecord[])
        if (
          old.account === account &&
          old.business === business &&
          old.state === "Synced"
        )
          s.delete(old.key);
      for (const item of incoming) {
        const id = String(item.data.id),
          key = recordKey(account, business, item.kind, id);
        const old = (r.result as LocalRecord[]).find((v) => v.key === key);
        if (!old || old.state === "Synced")
          s.put({
            key,
            account,
            business,
            kind: item.kind,
            id,
            data: item.data,
            version: Number(item.data.offline_revision),
            state: "Synced",
          } satisfies LocalRecord);
      }
    };
  });
}
export async function resolveConflict(record: LocalRecord, useServer: boolean) {
  const op = (await operations(record.account, record.business)).find(
    (o) => o.key === record.key,
  );
  if (!op || op.state !== "Conflict") throw new Error("No conflict to resolve");
  return transaction<void>(["records", "queue"], (t) => {
    t.objectStore("queue").delete(op.id);
    if (useServer) {
      t.objectStore("records").delete(record.key);
      if (record.server)
        t.objectStore("records").put({
          ...record,
          data: record.server,
          version: Number(record.server.offline_revision),
          state: "Synced",
          deleted: false,
          server: undefined,
          error: undefined,
        });
    } else {
      if (
        !record.server ||
        (record.kind === "invoices" && record.server.status !== "draft")
      ) {
        t.abort();
        return;
      }
      t.objectStore("records").put({
        ...record,
        version: Number(record.server.offline_revision),
        state: "Saved on this device",
        server: undefined,
        error: undefined,
      });
    }
  });
}
export async function clearAccount(account: string) {
  return transaction<void>(["records", "queue", "meta"], (t) => {
    for (const name of ["records", "queue"]) {
      const s = t.objectStore(name),
        r = s.getAll();
      r.onsuccess = () => {
        for (const row of r.result)
          if (row.account === account)
            s.delete(name === "records" ? row.key : row.id);
      };
    }
    const s = t.objectStore("meta"),
      r = s.getAll();
    r.onsuccess = () => {
      for (const m of r.result)
        if (
          m.id === `businesses:${account}` ||
          m.id === "identity" ||
          m.value?.row?.account === account
        )
          s.delete(m.id);
    };
  });
}
