import { authorizeScheduler } from "./scheduler.ts";

Deno.test("scheduler rejects unauthorized calls and requires POST", () => {
  const original = Deno.env.get("SCHEDULER_SECRET");
  try {
    Deno.env.delete("SCHEDULER_SECRET");
    if (authorizeScheduler(new Request("https://example.test", { method: "POST" }))?.status !== 503) throw new Error("Missing configuration must fail closed");
    Deno.env.set("SCHEDULER_SECRET", "test-only-secret");
    if (authorizeScheduler(new Request("https://example.test"))?.status !== 405) throw new Error("GET must be rejected");
    if (authorizeScheduler(new Request("https://example.test", { method: "POST" }))?.status !== 401) throw new Error("Missing secret must be rejected");
    if (authorizeScheduler(new Request("https://example.test", { method: "POST", headers: { "x-scheduler-secret": "wrong" } }))?.status !== 401) throw new Error("Wrong secret must be rejected");
    if (authorizeScheduler(new Request("https://example.test", { method: "POST", headers: { "x-scheduler-secret": "test-only-secret" } })) !== null) throw new Error("Authorized scheduler must be accepted");
  } finally {
    if (original === undefined) Deno.env.delete("SCHEDULER_SECRET"); else Deno.env.set("SCHEDULER_SECRET",original);
  }
});
