import { chromium } from "@playwright/test";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve("public");
let networkDisabled = false;
let workerRevision = 0;
const server = http.createServer(async (req, res) => {
  if (networkDisabled) {
    req.socket.destroy();
    return;
  }
  try {
    const name = new URL(req.url, "http://localhost").pathname;
    const file = path.resolve(root, "." + name);
    if (!file.startsWith(root + path.sep)) throw new Error();
    const bytes = await fs.readFile(file);
    const ext = path.extname(file);
    res.writeHead(200, {
      "Content-Type":
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".png": "image/png",
          ".svg": "image/svg+xml",
          ".webmanifest": "application/manifest+json",
        }[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "Service-Worker-Allowed": "/",
    });
    res.end(
      name === "/sw.js"
        ? Buffer.concat([
            bytes,
            Buffer.from(`\n// test update ${workerRevision}`),
          ])
        : bytes,
    );
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
await fs.mkdir("work", { recursive: true });
const profile = await fs.mkdtemp(path.resolve("work/browser-offline-"));
const options = {
  headless: true,
  ...(process.env.MFARO_CHROME_PATH
    ? { executablePath: process.env.MFARO_CHROME_PATH }
    : {}),
};
let context;
try {
  context = await chromium.launchPersistentContext(profile, options);
  const page = context.pages()[0];
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Test fixture only: represents a previous verified login and downloaded business.
  await page.goto(origin + "/offline/index.html");
  await page.waitForSelector(".offline-workspace");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    await new Promise((resolve) => {
      if (navigator.serviceWorker.controller) return resolve();
      navigator.serviceWorker.addEventListener("controllerchange", resolve, {
        once: true,
      });
    });
  });
  const account = "11111111-1111-4111-8111-111111111111",
    business = "22222222-2222-4222-8222-222222222222";
  await page.evaluate(
    async ({ account, business }) => {
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open("mfaro-workspace", 1);
        r.onupgradeneeded = () => {
          for (const n of ["meta", "records", "queue"])
            r.result.createObjectStore(n, {
              keyPath: n === "records" ? "key" : "id",
            });
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      await new Promise((resolve, reject) => {
        const t = db.transaction(["meta", "records", "queue"], "readwrite");
        t.objectStore("records").clear();
        t.objectStore("queue").clear();
        t.objectStore("meta").clear();
        t.objectStore("meta").put({
          id: "identity",
          value: { id: account, email: "offline-test@example.test" },
        });
        t.objectStore("meta").put({
          id: `businesses:${account}`,
          value: [
            {
              id: business,
              name: "Offline Test Business",
              currency_code: "ZAR",
            },
          ],
        });
        t.oncomplete = resolve;
        t.onerror = () => reject(t.error);
      });
      db.close();
    },
    { account, business },
  );
  networkDisabled = true;
  await context.setOffline(true);
  await page.reload();
  await page.getByText("offline-test@example.test", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Clients", exact: true }).click();
  await page.getByRole("button", { name: "New customer", exact: true }).click();
  await page
    .locator('.offline-editor [role="status"]')
    .filter({ hasText: "Not saved" })
    .waitFor();
  await page
    .getByLabel("Customer name", { exact: true })
    .fill("Restart Customer");
  await page
    .getByRole("button", { name: "Save record on this device", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Saved on this device" })
    .waitFor();
  await context.close();
  context = await chromium.launchPersistentContext(profile, options);
  await context.setOffline(true);
  const restarted = context.pages()[0];
  await restarted.goto(origin + "/offline/index.html");
  await restarted.getByRole("button", { name: "Clients", exact: true }).click();
  await restarted.getByText("Restart Customer", { exact: true }).waitFor();
  await restarted
    .getByRole("button", { name: "Overview", exact: true })
    .click();
  await restarted
    .getByRole("button", { name: "Create invoice", exact: true })
    .click();
  await restarted
    .getByLabel("Customer", { exact: true })
    .selectOption({ label: "Restart Customer" });
  await restarted
    .getByLabel("Description", { exact: true })
    .fill("Offline service");
  await restarted.getByLabel("Unit price", { exact: true }).fill("100");
  await restarted.getByLabel("Tax %", { exact: true }).fill("15");
  await restarted
    .getByRole("button", { name: "Save draft on this device", exact: true })
    .click();
  await restarted
    .getByRole("status")
    .filter({ hasText: "Saved on this device" })
    .waitFor();
  assert.match(
    await restarted.locator(".invoice-grand-total").innerText(),
    /115\.00/,
  );
  await restarted.getByRole("button", { name: "Close", exact: true }).click();
  await restarted
    .locator(".offline-records li")
    .filter({ hasText: "Offline draft" })
    .first()
    .getByRole("button", { name: "Queue sync", exact: true })
    .click();
  await restarted.getByText("Pending sync", { exact: true }).waitFor();
  await restarted.reload();
  await restarted
    .getByText(/Offline draft/)
    .first()
    .waitFor();
  // Sidebar layout must remain outside the business content, with a vertical menu.
  const sidebar = restarted.getByRole("complementary", { name: "Application sidebar" });
  const navigation = restarted.getByRole("navigation", { name: "Business navigation" });
  const sidebarBox = await sidebar.boundingBox();
  const contentBox = await restarted.locator(".offline-workspace").boundingBox();
  const topbarBox = await restarted.locator(".app-topbar").boundingBox();
  const logoBox = await sidebar.locator(".sidebar-brand").boundingBox();
  const navigationBox = await navigation.boundingBox();
  assert.ok(sidebarBox && contentBox && topbarBox && logoBox && navigationBox);
  assert.equal(sidebarBox.x, 0);
  assert.ok(contentBox.x >= sidebarBox.x + sidebarBox.width - 1);
  assert.ok(topbarBox.x >= sidebarBox.x + sidebarBox.width - 1);
  const statusBox = await restarted.locator(".pwa-status").boundingBox();
  if (statusBox && statusBox.height > 0) assert.ok(statusBox.x >= sidebarBox.width - 1);
  assert.ok(logoBox.y + logoBox.height <= navigationBox.y);
  const menuItems = navigation.getByRole("button");
  assert.equal(await menuItems.count(), 15);
  const positions = await menuItems.evaluateAll(items => items.map(item => {
    const box = item.getBoundingClientRect(); return { x: box.x, y: box.y, height: box.height };
  }));
  for (let index = 1; index < positions.length; index++) {
    assert.ok(Math.abs(positions[index].x - positions[0].x) < 1);
    assert.ok(positions[index].y >= positions[index - 1].y + positions[index - 1].height);
  }
  assert.equal(await navigation.getByRole("button", { name: "Overview", exact: true }).getAttribute("aria-current"), "page");
  assert.equal(await navigation.getByRole("button", { name: "Overview", exact: true }).evaluate(element => getComputedStyle(element).borderLeftColor), "rgb(0, 168, 107)");
  await menuItems.last().scrollIntoViewIfNeeded();
  assert.equal(await menuItems.last().isVisible(), true);
  const lastItemBox = await menuItems.last().boundingBox();
  const scrollerBox = await navigation.boundingBox();
  assert.ok(lastItemBox && scrollerBox);
  assert.ok(lastItemBox.y >= scrollerBox.y - 1);
  assert.ok(lastItemBox.y + lastItemBox.height <= scrollerBox.y + scrollerBox.height + 1);
  await navigation.evaluate(element => { element.scrollTop = 0; });
  await restarted.screenshot({
    path: "work/desktop-dashboard-aligned.png",
    fullPage: true,
  });
  await restarted.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await restarted.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  const menuToggle = restarted.getByRole("button", { name: "Menu", exact: true });
  assert.equal(await menuToggle.getAttribute("aria-expanded"), "false");
  assert.equal(await navigation.isVisible(), false);
  await menuToggle.focus();
  await restarted.keyboard.press("Enter");
  assert.equal(await menuToggle.getAttribute("aria-expanded"), "true");
  assert.equal(await navigation.isVisible(), true);
  await navigation.getByRole("button", { name: "Clients", exact: true }).click();
  assert.equal(await menuToggle.getAttribute("aria-expanded"), "false");
  assert.equal(await menuToggle.evaluate(element => document.activeElement === element), true);
  await restarted.getByRole("heading", { name: "Clients", exact: true }).waitFor();
  await menuToggle.click();
  await navigation.getByRole("button", { name: "Overview", exact: true }).click();
  await restarted.getByRole("heading", { name: "Know what’s next.", exact: true }).waitFor();
  await restarted.screenshot({
    path: "work/desktop-dashboard-mobile.png",
    fullPage: true,
  });
  await restarted.setViewportSize({ width: 1280, height: 720 });
  await restarted.emulateMedia({ media: "print" });
  assert.equal(await sidebar.isVisible(), false);
  assert.equal(await restarted.locator(".app-topbar").isVisible(), false);
  assert.equal(await restarted.locator(".app-shell").evaluate(element => getComputedStyle(element).paddingLeft), "0px");
  await restarted.emulateMedia({ media: "screen" });
  await restarted
    .getByRole("button", { name: "Invoices", exact: true })
    .click();
  await restarted
    .getByRole("button", { name: "New offline draft", exact: true })
    .click();
  await restarted
    .getByLabel("Notes", { exact: true })
    .fill("Unfinished recovery text");
  await restarted
    .getByText("Editing saved on this device. Save draft when ready.", {
      exact: true,
    })
    .waitFor();
  await restarted.reload();
  const recoveryRow = await restarted.evaluate(async () => {
    return await new Promise((resolve, reject) => {
      const r = indexedDB.open("mfaro-workspace", 1);
      r.onsuccess = () => {
        const q = r.result.transaction("meta").objectStore("meta").getAll();
        q.onsuccess = () =>
          resolve(
            q.result.some(
              (m) => m.value?.data?.notes === "Unfinished recovery text",
            ),
          );
        q.onerror = () => reject(q.error);
      };
    });
  });
  assert.equal(recoveryRow, true);
  await restarted.goto(origin + "/app/offline-fallback");
  await restarted
    .getByRole("heading", { name: "Know what’s next.", exact: true })
    .waitFor();
  await restarted.goto(origin + "/offline/index.html");
  networkDisabled = false;
  await context.setOffline(false);
  workerRevision++;
  await restarted.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration("/");
    await registration.update();
  });
  const updateButton = restarted.getByRole("button", {
    name: "Update & refresh",
    exact: true,
  });
  await updateButton.waitFor();
  await restarted.evaluate(() => {
    window.mfaroDirty = true;
  });
  const warning = restarted.waitForEvent("dialog");
  const attemptedClick = updateButton.click();
  const blocked = await warning;
  assert.match(blocked.message(), /unfinished edits/);
  await blocked.dismiss();
  await attemptedClick;
  assert.equal(await updateButton.isVisible(), true);
  await restarted.evaluate(() => {
    window.mfaroDirty = false;
  });
  restarted.once("dialog", (dialog) => void dialog.accept());
  await Promise.all([restarted.waitForEvent("load"), updateButton.click()]);
  await restarted.locator(".offline-workspace").waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Chrome headless offline launch, navigation fallback, persistent profile restart, customer/draft/queue persistence, tax totals, unfinished-edit recovery and update guard. Sidebar positioning, mobile disclosure and print layout passed. Installed OS/PWA UI and physical printing are separate checks.",
  );
} catch (error) {
  if (context) {
    const p = context.pages()[0];
    console.error({
      url: p?.url(),
      body: await p
        ?.locator("body")
        .innerText()
        .catch(() => ""),
      error: String(error),
    });
    await p?.screenshot({
      path: "work/browser-offline-failure.png",
      fullPage: true,
    });
  }
  throw error;
} finally {
  if (context) await context.close();
  await new Promise((resolve) => server.close(resolve));
}
