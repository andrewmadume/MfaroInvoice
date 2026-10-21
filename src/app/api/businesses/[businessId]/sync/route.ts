import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const uuid = z.string().uuid();
const timePayload = z.object({ projectId: uuid, entryDate: z.string().date(), minutes: z.number().int().min(1).max(1440), description: z.string().trim().min(1).max(500), billable: z.boolean() });
const inventoryPayload = z.object({ productId: uuid, quantityDelta: z.number().finite().refine((value) => value !== 0), reason: z.enum(["purchase", "sale", "adjustment", "return"]), note: z.string().trim().max(500).nullable().optional() });
const requestSchema = z.discriminatedUnion("type", [z.object({ operationId: uuid, businessId: uuid, type: z.literal("time_entry.create"), payload: timePayload }), z.object({ operationId: uuid, businessId: uuid, type: z.literal("inventory.adjust"), payload: inventoryPayload })]);

export async function POST(request: Request, { params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid-json" }, { status: 400 }); }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success || parsed.data.businessId !== businessId) return NextResponse.json({ error: "invalid-operation" }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { data, error } = await supabase.rpc("apply_sync_operation", { p_business_id: businessId, p_client_operation_id: parsed.data.operationId, p_operation_type: parsed.data.type, p_payload: parsed.data.payload });
  if (error) return NextResponse.json({ error: "sync-rejected" }, { status: 403 });
  return NextResponse.json({ status: data }, { headers: { "Cache-Control": "no-store" } });
}
