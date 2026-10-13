import { NextRequest } from "next/server";
import { confirmEmail } from "@/app/(auth)/actions";

export async function GET(request: NextRequest) {
  await confirmEmail(request.nextUrl.searchParams.get("code") ?? undefined);
}
