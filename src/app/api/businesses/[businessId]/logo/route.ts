import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, { params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const path = request.nextUrl.searchParams.get("path") || "";
  if (!z.string().uuid().safeParse(businessId).success || !new RegExp(`^${businessId}/[0-9a-f-]{36}\\.png$`).test(path)) return new NextResponse(null, { status: 404 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse(null, { status: 401 });
  const { data, error } = await supabase.storage.from("business-logos").download(path);
  if (error || !data) return new NextResponse(null, { status: 404 });
  return new NextResponse(data, { headers: { "content-type": "image/png", "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}
