import { acknowledge, fail, operations } from "./storage";
import { retryDelay, type Operation, type RecordData } from "./model";

export type SyncResult = {
  outcome: "ok" | "conflict";
  record: RecordData | null;
  version: number;
};
export async function syncQueue(
  account: string,
  business: string,
  send: (op: Operation) => Promise<SyncResult>,
  now = Date.now(),
) {
  // Web Locks serialises windows and prevents stale acknowledgements after edits.
  const run = async () => {
    const queue = (await operations(account, business)).sort(
      (a, b) => Number(a.kind === "invoices") - Number(b.kind === "invoices"),
    );
    for (const op of queue) {
      if (op.state === "Conflict" || op.nextAttempt > now) continue;
      try {
        const result = await send(op);
        if (result.outcome === "conflict")
          await fail(
            { ...op, state: "Conflict" },
            "The server record changed. Review both versions.",
            true,
            result.record,
          );
        else await acknowledge(op, result.record, result.version);
      } catch (error) {
        const attempts = op.attempts + 1;
        await fail(
          {
            ...op,
            attempts,
            state: "Sync failed",
            nextAttempt: now + retryDelay(attempts),
          },
          error instanceof Error ? error.message : "Sync failed",
          false,
        );
        break;
      }
    }
  };
  if (globalThis.navigator?.locks)
    await navigator.locks.request(`mfaro-sync:${account}:${business}`, run);
  else await run();
}
