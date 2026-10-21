export function applicationUrl(env: Record<string, string | undefined> = process.env): string {
  const configured = env.NEXT_PUBLIC_SITE_URL;
  const vercelHost = env.VERCEL_ENV === "preview"
    ? env.VERCEL_URL
    : env.VERCEL_PROJECT_PRODUCTION_URL ?? env.VERCEL_URL;
  if (!configured && !vercelHost) throw new Error("Configure NEXT_PUBLIC_SITE_URL or Vercel system environment variables");
  const url = new URL(configured ?? `https://${vercelHost}`);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("The application URL must use HTTPS outside localhost");
  }
  if (url.username || url.password) throw new Error("The application URL cannot contain credentials");
  return url.origin;
}
