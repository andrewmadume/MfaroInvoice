import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const ids = z.object({ businessId: z.string().uuid(), documentId: z.string().uuid() });

export async function GET(request: NextRequest, { params }: { params: Promise<{ businessId: string; documentId: string }> }) {
  const parsed = ids.safeParse(await params); if (!parsed.success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: document, error } = await supabase.from("documents").select("storage_path").eq("id", parsed.data.documentId).eq("business_id", parsed.data.businessId).maybeSingle();
  if (error || !document) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: signed, error: signedError } = await supabase.storage.from("business-documents").createSignedUrl(document.storage_path, 60);
  if (signedError || !signed?.signedUrl) return NextResponse.json({ error: "Document unavailable" }, { status: 404 });
  return NextResponse.redirect(signed.signedUrl, { headers: { "cache-control": "no-store" } });
}
