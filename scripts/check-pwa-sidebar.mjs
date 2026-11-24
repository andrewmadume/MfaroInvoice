import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";

const root = process.cwd();
const fixtureDirectory = path.join(root, "src/app/pwa-sidebar-check");
const fixtureFile = path.join(fixtureDirectory, "page.tsx");
const businessId = "11111111-1111-4111-8111-111111111111";
const fixture = `// Generated only by the PWA sidebar CI harness; never commit this route.
import { BusinessNav } from "@/components/business-nav";
export default function SidebarCheck() {
  return <main className="app-shell">
    <BusinessNav businessId="${businessId}" name="MfaroInvoice Demo Business" />
    <section className="workspace">
      <div className="page-title"><div><p className="eyebrow">BUSINESS OVERVIEW</p><h1>Navigation check</h1></div></div>
      <div className="stat-grid"><article><span>Outstanding</span><strong>ZAR 0.00</strong></article><article><span>Clients</span><strong>0</strong></article></div>
      <section className="form-card"><h2>Workspace content</h2><label>Example input<input aria-label="Example input" defaultValue="Keep this value" /></label></section>
    </section>
  </main>;
}
`;
const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-build-fixture",
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function cleanup() {
  let content;
  try { content = await fs.readFile(fixtureFile, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  if (content !== fixture) throw new Error("Refusing to remove a fixture file this harness did not generate");
  await fs.unlink(fixtureFile);
  await fs.rmdir(fixtureDirectory);
}

if (process.argv.includes("--prepare")) {
  await fs.mkdir(fixtureDirectory); // Refuse to overwrite a pre-existing route.
  await fs.writeFile(fixtureFile, fixture, { flag: "wx" });
  console.log("Prepared the temporary PWA navigation route.");
} else if (process.argv.includes("--cleanup")) {
  await cleanup();
} else if (process.argv.includes("--verify")) {
  assert.equal(await fs.readFile(fixtureFile, "utf8"), fixture);
  const toolRequire = createRequire(path.join(root, ".tools/pwa-browser/package.json"));
  const { chromium } = toolRequire("@playwright/test");
  const rootRequire = createRequire(path.join(root, "package.json"));
  const portServer = net.createServer();
  await new Promise((resolve, reject) => { portServer.once("error", reject); portServer.listen(0, "127.0.0.1", resolve); });
  const port = portServer.address().port;
  await new Promise((resolve) => portServer.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [rootRequire.resolve("next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  let logs = "";
  let startError;
  server.on("error", (error) => { startError = error; });
  for (const stream of [server.stdout, server.stderr]) stream.on("data", (chunk) => { logs = (logs + chunk.toString()).slice(-16000); });
  let browser;
  let page;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (startError) throw startError;
      if (server.exitCode !== null) throw new Error("Next.js exited before the fixture became ready");
      try { ready = (await fetch(origin + "/pwa-sidebar-check", { signal: AbortSignal.timeout(1500) })).ok; } catch {}
      if (ready) break;
      await sleep(250);
    }
    if (!ready) throw new Error("Next.js fixture did not become ready");
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await context.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(origin + "/pwa-sidebar-check");
    await page.getByRole("heading", { name: "Navigation check", exact: true }).waitFor();
    const sidebar = page.getByRole("complementary", { name: "Application sidebar" });
    const navigation = page.getByRole("navigation", { name: "Business navigation" });
    const menu = page.getByRole("button", { name: "Menu", exact: true });
    const links = navigation.getByRole("link");
    const entries = [["Overview", ""], ["Invoices", "/invoices"], ["Expenses", "/expenses"], ["Quotes", "/quotes"], ["Recurring", "/recurring"], ["Clients", "/clients"], ["Inventory", "/inventory"], ["Time", "/time"], ["Documents", "/documents"], ["Reports", "/reports"], ["Analytics", "/analytics"], ["Payments", "/payments"], ["Sync", "/sync"], ["Security", "/security"], ["Templates & settings", "/settings"]];
    assert.equal(await links.count(), entries.length);
    for (const [label, suffix] of entries) assert.equal(await navigation.getByRole("link", { name: label, exact: true }).getAttribute("href"), `/app/${businessId}${suffix}`);
    const sideBox = await sidebar.boundingBox();
    const contentBox = await page.locator(".workspace").boundingBox();
    const headerBox = await page.locator(".app-topbar").boundingBox();
    const logoBox = await sidebar.locator(".sidebar-brand").boundingBox();
    const navBox = await navigation.boundingBox();
    assert.ok(sideBox && contentBox && headerBox && logoBox && navBox);
    assert.equal(sideBox.x, 0);
    assert.equal(await sidebar.evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(180, 212, 247)");
    assert.ok(contentBox.x >= sideBox.width - 1);
    assert.ok(headerBox.x >= sideBox.width - 1);
    assert.ok(logoBox.y + logoBox.height <= navBox.y);
    const positions = await links.evaluateAll((items) => items.map((item) => { const b = item.getBoundingClientRect(); return { x: b.x, y: b.y, height: b.height }; }));
    positions.slice(1).forEach((b, index) => { assert.ok(Math.abs(b.x - positions[0].x) < 1); assert.ok(b.y >= positions[index].y + positions[index].height - 1); });
    async function setPath(suffix, active) {
      await page.evaluate((url) => history.replaceState(null, "", url), `/app/${businessId}${suffix}`);
      await page.waitForFunction((label) => {
        const current = [...document.querySelectorAll('nav[aria-label="Business navigation"] a[aria-current="page"]')];
        return label === null ? current.length === 0 : current.length === 1 && current[0].textContent === label;
      }, active);
    }
    await setPath("", "Overview");
    await setPath("/invoices", "Invoices");
    await setPath("/invoices/new", "Invoices");
    await setPath("/invoices-archive", null);
    await setPath("", "Overview");
    const activeStyle = await navigation.getByRole("link", { name: "Overview", exact: true }).evaluate((element) => ({ border: getComputedStyle(element).borderLeftColor, background: getComputedStyle(element).backgroundColor }));
    assert.equal(activeStyle.border, "rgb(0, 168, 107)");
    assert.ok(["rgba(0, 0, 0, 0)", "transparent"].includes(activeStyle.background));

    await page.setViewportSize({ width: 1366, height: 420 });
    await links.last().scrollIntoViewIfNeeded();
    const last = await links.last().boundingBox();
    const scroller = await navigation.boundingBox();
    assert.ok(last && scroller && last.y >= scroller.y - 1 && last.y + last.height <= scroller.y + scroller.height + 1);
    assert.ok(last.y >= -1 && last.y + last.height <= 421);
    assert.equal(await navigation.evaluate((element) => element.scrollHeight > element.clientHeight && element.scrollTop > 0), true);
    await page.setViewportSize({ width: 1366, height: 900 });
    await sidebar.evaluate((element) => { element.scrollTop = 0; });
    await navigation.evaluate((element) => { element.scrollTop = 0; });
    await fs.mkdir(path.join(root, "work"), { recursive: true });
    await page.screenshot({ path: "work/pwa-sidebar-desktop.png", fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await menu.getAttribute("aria-expanded"), "false");
    assert.equal(await navigation.isVisible(), false);
    await menu.focus();
    await page.keyboard.press("Enter");
    await navigation.waitFor({ state: "visible" });
    assert.equal(await menu.getAttribute("aria-expanded"), "true");
    // Keep clicks inside this fake organisation's fixture. Real hrefs were checked above.
    await page.evaluate(() => document.addEventListener("click", (event) => { if (event.target instanceof Element && event.target.closest('nav[aria-label="Business navigation"] a')) event.preventDefault(); }, true));
    await navigation.getByRole("link", { name: "Clients", exact: true }).click();
    await navigation.waitFor({ state: "hidden" });
    assert.equal(await menu.evaluate((element) => document.activeElement === element), true);
    assert.equal(await page.getByLabel("Example input").inputValue(), "Keep this value");
    await menu.click();
    await navigation.getByRole("link", { name: "Invoices", exact: true }).focus();
    await page.keyboard.press("Escape");
    await navigation.waitFor({ state: "hidden" });
    assert.equal(await menu.evaluate((element) => document.activeElement === element), true);
    const previousNames = await page.locator(".sidebar-business strong, .app-topbar .business-name").allTextContents();
    await page.locator(".sidebar-business strong, .app-topbar .business-name").evaluateAll((elements) => elements.forEach((element) => { element.textContent = "LongOrganisationName".repeat(8); }));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator(".sidebar-business strong, .app-topbar .business-name").evaluateAll((elements, names) => elements.forEach((element, index) => { element.textContent = names[index]; }), previousNames);
    await page.screenshot({ path: "work/pwa-sidebar-mobile.png", fullPage: true });
    await page.emulateMedia({ media: "print" });
    assert.equal(await sidebar.isVisible(), false);
    assert.equal(await page.locator(".app-topbar").isVisible(), false);
    assert.equal(await page.locator(".app-shell").evaluate((element) => getComputedStyle(element).paddingLeft), "0px");
    await page.emulateMedia({ media: "screen" });
    assert.deepEqual(pageErrors, []);
    console.log("PASS: real PWA navigation routes, nested active states, sidebar geometry, short-window scrolling, mobile keyboard/focus, long names and print layout.");
  } catch (error) {
    console.error(logs);
    if (page) {
      console.error({ url: page.url(), body: await page.locator("body").innerText().catch(() => "") });
      await fs.mkdir(path.join(root, "work"), { recursive: true });
      await page.screenshot({ path: "work/pwa-sidebar-failure.png", fullPage: true }).catch(() => {});
    }
    throw error;
  } finally {
    if (browser) await browser.close();
    if (server.exitCode === null) {
      const exited = new Promise((resolve) => server.once("exit", resolve));
      server.kill("SIGTERM");
      await Promise.race([exited, sleep(3000)]);
      if (server.exitCode === null) server.kill("SIGKILL");
    }
    await cleanup();
  }
} else {
  throw new Error("Use --prepare before the production test build, --verify after it, or --cleanup.");
}
