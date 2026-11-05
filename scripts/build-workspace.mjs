import { build } from "esbuild-wasm";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
// Read only explicitly public values. No server environment file is bundled.
const env = { ...process.env };
for (const file of [".env.local", ".env"]) {
  try {
    for (const line of (await readFile(file, "utf8")).split(/\r?\n/)) {
      const m = line.match(
        /^(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)=(.*)$/,
      );
      if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
    }
  } catch {}
}
const url = env.NEXT_PUBLIC_SUPABASE_URL,
  key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key || new URL(url).protocol !== "https:")
  throw new Error(
    "Set public Supabase URL and publishable key before building",
  );
if (key.startsWith("sb_secret_")) throw new Error("Never bundle secret keys");
if (key.split(".").length === 3) {
  const claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url"));
  if (claims.role !== "anon")
    throw new Error("Only the public anon role may be bundled");
}
await mkdir("public/offline", { recursive: true });
await build({
  entryPoints: ["./src/offline/workspace.tsx"],
  tsconfig: "./tsconfig.json",
  bundle: true,
  outfile: "public/offline/workspace.js",
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  jsx: "automatic",
  minify: true,
  define: {
    "process.env.NODE_ENV": '"production"',
    "process.env.NEXT_PUBLIC_SUPABASE_URL": JSON.stringify(url),
    "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(key),
  },
});
await writeFile(
  "public/offline/config.json",
  JSON.stringify({ supabaseUrl: url }),
);
await writeFile(
  "public/offline/index.html",
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MfaroInvoice — Device workspace</title><meta name="theme-color" content="#061b6b"><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/icons/apple-touch-v3.png"><link rel="stylesheet" href="/offline/workspace.css"></head><body><div id="root"><p>Opening MfaroInvoice… If this message remains, reconnect once to finish downloading the workspace.</p></div><script type="module" src="/offline/workspace.js"></script></body></html>`,
);
// Native icons preserve the supplied artwork. ICO uses PNG-compressed entries.
const png = await sharp("public/icons/app-512-v3.png")
  .resize(256, 256)
  .png()
  .toBuffer();
const ico = Buffer.alloc(22);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(1, 4);
ico[6] = 0;
ico[7] = 0;
ico.writeUInt16LE(1, 10);
ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png.length, 14);
ico.writeUInt32LE(22, 18);
await writeFile("desktop/icon.ico", Buffer.concat([ico, png]));
const large = await readFile("public/icons/app-512-v3.png"),
  entry = Buffer.alloc(8);
entry.write("ic09");
entry.writeUInt32BE(large.length + 8, 4);
const header = Buffer.alloc(8);
header.write("icns");
header.writeUInt32BE(large.length + 16, 4);
await writeFile("desktop/icon.icns", Buffer.concat([header, entry, large]));
console.log("Shared browser/desktop workspace built from local assets.");
const digest = createHash("sha256")
  .update(await readFile("public/offline/workspace.js"))
  .update(await readFile("public/offline/workspace.css"))
  .digest("hex")
  .slice(0, 16);
await writeFile(
  "public/sw.js",
  (await readFile("scripts/service-worker.js", "utf8")).replace(
    "WORKSPACE_VERSION",
    digest,
  ),
);
