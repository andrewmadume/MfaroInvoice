export function authorizeScheduler(request: Request): Response | null {
  if (request.method !== "POST") return new Response("Method not allowed",{status:405});
  const expected = Deno.env.get("SCHEDULER_SECRET");
  if (!expected) return new Response("Scheduler not configured",{status:503});
  if (request.headers.get("x-scheduler-secret") !== expected) return new Response("Unauthorized",{status:401});
  return null;
}
