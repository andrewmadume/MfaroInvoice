export type SyncOperation = {
  operationId: string;
  businessId: string;
  type: "time_entry.create" | "inventory.adjust";
  payload: Record<string, unknown>;
  createdAt: string;
};

const databaseName = "mfaro-invoice-offline";
const storeName = "operations";

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName, { keyPath: "operationId" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function queueOperation(operation: Omit<SyncOperation, "operationId" | "createdAt">) {
  const item: SyncOperation = { ...operation, operationId: crypto.randomUUID(), createdAt: new Date().toISOString() };
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => { const transaction = db.transaction(storeName, "readwrite"); transaction.objectStore(storeName).put(item); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
  db.close();
  return item;
}

export async function pendingOperations(businessId: string) {
  const db = await openDatabase();
  const items = await new Promise<SyncOperation[]>((resolve, reject) => { const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll(); request.onsuccess = () => resolve((request.result as SyncOperation[]).filter((item) => item.businessId === businessId)); request.onerror = () => reject(request.error); });
  db.close();
  return items;
}

export async function removeOperation(operationId: string) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => { const transaction = db.transaction(storeName, "readwrite"); transaction.objectStore(storeName).delete(operationId); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
  db.close();
}
