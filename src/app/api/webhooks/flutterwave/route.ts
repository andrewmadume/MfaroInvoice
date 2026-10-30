import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { finalizeProviderPayment } from "@/lib/payment-finalization";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const hash = process.env.FLUTTERWAVE_WEBHOOK_HASH; if (!hash) return NextResponse.json({ error: "not-configured" }, { status: 503 });
  const supplied = request.headers.get("verif-hash") ?? "";
  if (supplied.length !== hash.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(hash))) return NextResponse.json({ error: "invalid-signature" }, { status: 401 });
  const event = await request.json() as { event?: string; data?: { id?: number; tx_ref?: string } };
  if (event.event !== "charge.completed" || !event.data?.id || !event.data.tx_ref) return NextResponse.json({ received: true });
  const secret = process.env.FLUTTERWAVE_SECRET_KEY; if (!secret) return NextResponse.json({ error: "not-configured" }, { status: 503 });
  const response = await fetch(`https://api.flutterwave.com/v3/transactions/${event.data.id}/verify`, { headers: { Authorization: `Bearer ${secret}` } });
  const verified = await response.json() as { status?: string; data?: { status?: string; tx_ref?: string; amount?: number; currency?: string; created_at?: string } };
  if (verified.status !== "success" || verified.data?.status !== "successful" || !verified.data.tx_ref || typeof verified.data.amount !== "number" || !verified.data.currency) return NextResponse.json({ error: "verification-failed" }, { status: 400 });
  await finalizeProviderPayment({ provider: "flutterwave", reference: verified.data.tx_ref, amount: verified.data.amount, currency: verified.data.currency, paidAt: verified.data.created_at });
  return NextResponse.json({ received: true });
}
