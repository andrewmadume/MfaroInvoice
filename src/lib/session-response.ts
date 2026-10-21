import type { NextResponse } from "next/server";

/** Preserve refreshed session cookies and prevent caching when redirecting. */
export function copySessionResponse(source: NextResponse, target: NextResponse) {
  for (const cookie of source.cookies.getAll()) target.cookies.set(cookie);
  for (const name of ["cache-control", "expires", "pragma"]) {
    const value = source.headers.get(name);
    if (value) target.headers.set(name, value);
  }
  return target;
}
