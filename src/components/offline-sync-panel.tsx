"use client";

import { useEffect, useState } from "react";
import { pendingOperations, queueOperation, removeOperation, type SyncOperation } from "@/lib/offline-queue";

type Option = { id: string; name: string };

export function OfflineSyncPanel({ businessId, projects, products }: { businessId: string; projects: Option[]; products: Option[] }) {
  const [pending, setPending] = useState<SyncOperation[]>([]);
  const [message, setMessage] = useState("Queued work remains on this device until it is securely synchronized.");
  const reload = async () => setPending(await pendingOperations(businessId));
  useEffect(() => {
    const online = () => {
      void (async () => {
        try { const queued = await pendingOperations(businessId); setPending(queued); } catch { setMessage("Could not open the device queue."); }
      })();
    };
    online();
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [businessId]);

  async function flush() {
    try {
    const queued = await pendingOperations(businessId);
    if (!queued.length) { setMessage("No queued work to synchronize."); return; }
    let completed = 0;
    for (const operation of queued) {
      const response = await fetch(`/api/businesses/${businessId}/sync`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(operation) });
      if (!response.ok) { setMessage(`Synchronization paused after ${completed} item${completed === 1 ? "" : "s"}. Check your connection or access.`); break; }
      await removeOperation(operation.operationId); completed += 1;
    }
    await reload();
    if (completed === queued.length) setMessage(`${completed} queued item${completed === 1 ? "" : "s"} synchronized securely.`);
    } catch { setMessage("Synchronization paused. Your unsent work remains on this device."); }
  }

  async function queueTime(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    try {
    await queueOperation({ businessId, type: "time_entry.create", payload: { projectId: data.get("projectId"), entryDate: data.get("entryDate"), minutes: Number(data.get("minutes")), description: data.get("description"), billable: true } });
    form.reset(); await reload(); setMessage("Time entry queued on this device. Use Sync now when you are online.");
    } catch { setMessage("Could not queue this item. Check device storage and try again."); }
  }

  async function queueInventory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    try {
    await queueOperation({ businessId, type: "inventory.adjust", payload: { productId: data.get("productId"), quantityDelta: Number(data.get("quantityDelta")), reason: data.get("reason"), note: data.get("note") } });
    form.reset(); await reload(); setMessage("Inventory adjustment queued on this device. Use Sync now when you are online.");
    } catch { setMessage("Could not queue this item. Check device storage and try again."); }
  }

  return <section className="workspace"><div className="page-title"><div><p className="eyebrow">OFFLINE-SAFE SYNC</p><h1>Queued work</h1></div><div className="actions"><button className="text-button" type="button" onClick={() => void reload()}>Refresh queue</button><button className="button" type="button" onClick={() => void flush()}>Sync now ({pending.length})</button></div></div><p className="notice">Only time entries and inventory adjustments can be queued. Credentials, payment data, and documents are never stored in the offline queue.</p><p className="success" aria-live="polite">{message}</p><div className="two-column"><section className="form-card"><h2>Queue time entry</h2><form onSubmit={queueTime}><label>Project<select name="projectId" required defaultValue=""><option disabled value="">Select project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label>Date<input name="entryDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label><label>Minutes<input name="minutes" type="number" min="1" max="1440" required /></label><label>Description<input name="description" maxLength={500} required /></label><button className="button" disabled={!projects.length}>Queue time</button></form></section><section className="form-card"><h2>Queue stock adjustment</h2><form onSubmit={queueInventory}><label>Product<select name="productId" required defaultValue=""><option disabled value="">Select product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label><label>Quantity change<input name="quantityDelta" type="number" step="0.0001" required /></label><label>Reason<select name="reason" defaultValue="adjustment"><option value="purchase">Purchase</option><option value="sale">Sale</option><option value="adjustment">Adjustment</option><option value="return">Return</option></select></label><label>Note<input name="note" maxLength={500} /></label><button className="button" disabled={!products.length}>Queue adjustment</button></form></section></div></section>;
}
