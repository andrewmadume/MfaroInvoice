# MfaroInvoice: PWA and desktop workspace

Version 0.1.1 opens the shared **Business overview** dashboard, using the same navigation and dashboard components as the PWA. Invoices, Clients and Inventory open saved local records; **Sync** opens the device controls. Navigation items marked ↗ open the selected organisation's online page in the default browser and require connectivity. Desktop totals describe downloaded records, not a live server aggregate. Backup, restore, organisation switching and logout are grouped under **Device & sync**. The application ID and IndexedDB names are unchanged, so installing this update does not intentionally clear existing local records.

## Architecture and scope

The existing Next.js application, Supabase Auth, RLS, payment functions and server-rendered business modules remain in place. `src/offline/workspace.tsx` is a React renderer built into `public/offline/` for both the web PWA and Electron. It reuses the existing invoice renderer, three templates, branding and money formatting. `src/offline/model.ts` provides shared validation and decimal calculations. PostgreSQL recalculates amounts authoritatively on sync. Nothing depends on an Electron development server or the hosted site to render the device workspace.

Next.js server actions and dynamic pages cannot run from static files. Consequently the packaged desktop interface provides customers, products/services, downloaded invoices, offline drafts, sync, backup and printing. Expenses, reports, payments, issuing invoices, onboarding and advanced administration continue through **Open online features** in the default browser. This is an intentional boundary, not a packaged copy of the Next.js server. Browser and desktop use the same device workspace and invoice templates; the full online app keeps its existing interface.

Both platforms use IndexedDB behind the shared storage module. Electron stores Chromium data inside `app.getPath('userData')` (normally `%APPDATA%/MfaroInvoice`, `~/Library/Application Support/MfaroInvoice`, or `~/.config/MfaroInvoice`). SQLite would introduce a separate persistence implementation and native-module maintenance without a current data-model benefit. The old time/stock queue is preserved in a separate database and now filters by account as well as business. Unattributed legacy queue items are retained but never automatically attributed to another login.

## Setup and commands

Use Node 22 or newer, `npm ci`, and public Supabase configuration in `.env.local` or environment variables:

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

Only these two public values are read by the static builder. Secret/service-role keys, `.env` files and the Next.js server are excluded from desktop packaging. JWT-style keys must have the `anon` role. Use the same project as the existing app. Never supply an administrator key.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Build shared assets, then Next.js development |
| `npm run build` / `npm start` | Shared assets plus production Next.js build / server |
| `npm run build:workspace` | Bundle static React workspace and generate native icons / versioned worker |
| `npm run desktop:dev` | Bundle and run Electron with local packaged-style assets |
| `npm run desktop:pack` | Produce an unpacked application for this OS |
| `npm run desktop:dist` | Produce this OS's unsigned distribution, never publish |
| `npm test` | Financial/security SQL and storage/sync/calculation tests |
| `npm run test:browser` | Headless browser offline and restart scenarios |
| `npm run typecheck` / `npm run lint` | Type and source checks |
| `node scripts/desktop-smoke.mjs` | Hidden Electron runtime/renderer/IDB/PDF checks |
| `node scripts/desktop-smoke.mjs "dist-desktop/win-unpacked/MfaroInvoice.exe"` | Check the actual packaged Windows application |

For browser tests install Chromium with `npx playwright install chromium`, or set `MFARO_CHROME_PATH` to an existing Chrome executable. The tests use an isolated temporary profile and fake local records, never real customer credentials. The WASM bundler avoids a native Go filesystem-access problem in the Windows sandbox.

Apply `supabase/migrations/20261105055420_offline_workspace_sync.sql` to the intended database **before making this feature available**. It adds revision triggers and a permission-checked RPC with private operation receipts. It is verified against the complete migration chain in isolated PostgreSQL (PGlite). This change has not been applied to the production Supabase project as part of this upgrade. Review migration history before `supabase db push`; earlier dashboard-applied migrations can have different recorded versions.

## Offline use and safety

1. Sign in while online. Existing browser sessions are reused; desktop signs into the same Supabase Auth project. Download/refresh records for each organisation you need offline.
2. Open **Device workspace** (`/offline/index.html`). Customers, products/services and downloaded invoice lines are available without a server. The current business profile and available private business logos are stored explicitly in IndexedDB, not in the service worker's HTTP cache.
3. Create or edit drafts and save on the device. Incomplete form edits are saved to a recovery buffer after 250 ms; the unsaved-change guard stays active until persistence completes. Device storage failures are shown. A browser can still evict site data or a user can clear it; regularly export a backup.
4. Choose **Queue sync** for a saved change. The payload and operation UUID become immutable until acknowledged. Launch, reconnection and a 15-second timer retry queued operations; no Background Sync support is assumed. Exponential retry delay caps at five minutes. `Sync now` respects a current backoff.
5. Offline drafts have an explicit temporary label and retain their UUID on the server. On first successful server creation, the existing transactionally locked number sequence assigns the invoice number. Retrying an operation uses its receipt instead of creating a second invoice or consuming a second number. A second operation for the same draft UUID produces a conflict, including an older restored backup; creation receipts also prevent resurrection of deleted records. Never copy a numbered draft to another ID to retry it.

**States:** Saved on this device = not sent; Pending sync = queued; Synced = acknowledged server result; Sync failed = work retained and retried; Conflict = stopped pending explicit resolution. A submitted payload is not editable while its outcome may be uncertain.

Server revision checks detect edits/deletions made on another device, including changes from existing web workflows. Conflicts show both versions. **Use server version** discards the local edit after confirmation; **Keep local edit** rebases it onto the current revision for review and a new operation. An issued or deleted invoice cannot be overwritten or resurrected by this flow. Referenced customers/products or draft invoices may fail deletion because of existing foreign-key rules; fix server dependencies or access and retry. Financial failures never turn into a fabricated success. Receipts must be retained: removing them invalidates long-delayed retry protection.

Payments, sending/issuing invoices, inventory posting and online-provider operations are not duplicated into the new invoice queue. Existing backend permissions, MFA requirements and accounting rules remain authoritative.

## Authentication and local data

First login and server verification require connectivity. Desktop password login supports an optional six-digit code for an existing verified TOTP factor; registration, MFA enrolment, SSO and password recovery use the online app. After a previous verified login, the remembered local account can open its downloaded organisation records while offline, including after a session expires. This local access is not a new server authorisation grant. Reconnection validates the user and all permissions before writing. A session failure pauses sync without removing drafts.

Records, recovery buffers and queued changes are partitioned by account UUID and organisation UUID. Switching organisation clears the displayed records/editor. A cloud auth account change hides the previous account. This is logical application separation, not protection from a person with access to the same OS/browser profile or developer tools. Use separate device profiles on shared computers.

Browser authentication retains the existing Supabase cookie model. Desktop session credentials use Electron's asynchronous `safeStorage` API and a fixed private session file; an unavailable secure OS keyring blocks persistent login, and Linux's `basic_text` fallback is rejected. **Invoice records and JSON backups are not encrypted.** Backups include customer and banking information: protect them as financial documents. Operating-system full-disk encryption is separate from app encryption.

**Sign out & erase local data** explicitly warns before deleting this account's downloaded records, recovery edits and pending queue. Export first. Other accounts and server records remain unchanged. Clearing browser data or removing an OS app-data directory also destroys local-only work. A normal online-site session change does not promise secure deletion of device storage; use the device workspace's erase action on shared devices.

Backup restore validates format, account, organisation, record IDs and payloads. It requires an empty local workspace so it cannot silently replace work. Pending operations retain their original IDs, including requests that may already have committed. Imported data is still validated and permission-checked by the server. Backups currently exclude cached logo images and business profile configuration; sign in and download the business profile on the destination first.

## Installation, updates and caching

Serve web production over HTTPS (localhost is allowed for development). The manifest has a stable `/` ID, root scope, standalone display and existing branded 192/512 PNG, separate maskable and Apple touch icons. Installed launches open the static workspace. Supported Chrome/Edge browsers expose an installation prompt; other browsers show manual instructions. iPhone/iPad: Safari → Share → Add to Home Screen → Open as Web App where offered. Supported macOS Safari: File → Add to Dock. Installation and background features vary by browser/OS; bookmarks remain supported.

The service worker precaches only the public workspace, logo and icons. It never caches authenticated HTML, APIs, RSC, Supabase results, uploaded invoices or arbitrary requests. Navigations use the network with the saved device workspace as the offline fallback. Old pages remain usable during updates. A new worker waits until all old windows close or the user explicitly chooses **Update & refresh**. That action blocks while unsaved edits are detected and asks the user to check other windows. No controller-change listener silently refreshes another window. Save work before closing/updating, particularly edits in other tabs.

Electron uses a secure standard `mfaro://app` protocol serving an exact allowlist of bundled assets. Its main/preload/renderer boundary enables context isolation, renderer sandboxing and web security, with Node disabled. CSP limits connections to the configured HTTPS Supabase origin. Navigation, new windows, webviews and permission requests are restricted. Validated, main-frame-only IPC exposes fixed credential storage, native backup dialogs, printing, PDF export, version information and opening the approved production site. No renderer-selected filesystem paths, shell commands or raw IPC are exposed.

PDF export uses Chromium's A4 print rendering on desktop, and the browser print / Save as PDF flow on the web. Printing/export requires opening an invoice first. Desktop output uses a temporary adjacent file and rename; cancellation does not report success. The web download fallback cannot prove that a user saved a file. Test real printers and OS dialog behaviour before release.

## Distribution and remaining release setup

`electron-builder.yml` configures Windows NSIS, macOS DMG/ZIP and Linux AppImage. `.github/workflows/desktop.yml` is a **manual**, three-OS candidate build with artifact upload only. Configure repository variables `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Public fixture values in web CI are only for tests, never release configuration. Run macOS packaging on macOS; run Linux packaging on Linux. macOS architecture follows its runner; add an explicit x64/arm64 matrix if distributing both architectures.

No release is published and no update feed exists. `publish: null` and `--publish never` enforce that boundary. Desktop updates are manual downloads/reinstalls preserving the OS app-data directory. Before enabling automatic updates, authorise a release repository/provider, select a feed/channel, add an updater with version/signature checks and explicit download/restart consent, and test rollback plus pending-work recovery. Do not describe automatic updates as working.

Candidate packages are unsigned. For an authorised production release configure secure CI secrets for Windows signing (`CSC_LINK`, `CSC_KEY_PASSWORD` or an approved signing service), enable `win.signExecutable`, and configure macOS Developer ID signing, hardened runtime and notarisation (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` or App Store Connect API secrets). Never commit certificates or credentials. Unsigned Windows/macOS packages can trigger OS warnings and are not suitable for broad trusted distribution.

See `docs/UPGRADE_VERIFICATION.md` for actual results and remaining device checks.

## Official API references checked

- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [custom protocols](https://www.electronjs.org/docs/latest/api/protocol), [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).
- [electron-builder targets](https://www.electron.build/v26/docs/targets/) (configuration pinned to builder 26).
- [PWA service workers](https://web.dev/learn/pwa/service-workers) and [update lifecycle](https://web.dev/learn/pwa/update).
- [Supabase password authentication](https://supabase.com/docs/reference/javascript/auth-signinwithpassword) and [verified user lookup](https://supabase.com/docs/reference/javascript/auth-getuser).
