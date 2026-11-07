# PWA / Electron upgrade verification

## Dashboard alignment update — 7 November 2026

Version 0.1.1 replaces the separate three-tab desktop landing screen with the shared PWA business navigation, Overview cards, recent-invoice table and Create invoice action. Device controls are grouped under Device & sync. A shared overview component is used by both the server-rendered PWA and the bundled renderer. Server-only areas remain explicitly marked as opening online; this update does not bundle the remaining Next.js server modules. No authentication, schema, invoice numbering or local database names were changed.

The updated checks include 15 automated tests (including saved-dashboard currency separation and exclusion of draft/deleted balances), the existing offline/restart/update browser workflow, and a 390px viewport overflow check. Desktop and narrow-screen browser screenshots are captured by the browser test. Installer/runtime limitations below remain applicable; browser screenshots do not verify a native Electron launch.

Date: 5 November 2026. Environment: Windows 11 host, Node 24; Chrome headless automation against an isolated localhost server and persistent test profile. No real customer documents or credentials were used.

## Implemented

- Shared static React device workspace for PWA and Electron, using existing branding and all three invoice templates. Existing online modules remain intact.
- Account/organisation-separated IndexedDB records, recovery buffers, persistent queue, backoff, reconnect/launch sync, idempotency receipts and optimistic server revisions.
- Offline customer/product editing, saved invoice viewing, invoice drafts, discounts/tax totals, backup/import, print/PDF adapters and explicit sync/conflict states.
- Root-scope PWA manifest, existing correctly sized branded PNG/maskable/Apple icons, public-shell-only caching, offline fallback, platform installation help and an explicit update guard.
- Sandboxed Electron renderer, context-isolated typed preload, restricted IPC/origins/navigation, native dialogs, private OS-backed credential storage, packaged assets, native icons and menus.
- NSIS, DMG/ZIP and AppImage build configuration; manual candidate-build CI for Windows/macOS/Linux. No release publishing or automatic update feed.
- Shared invoice-line validation and decimal estimates in the existing online financial form and the device workspace. PostgreSQL remains authoritative.

## Results

| Check | Actual result |
| --- | --- |
| `npm test` | 14 tests passed: nine existing/expanded finance and SQL scenarios plus five offline/desktop tests |
| Complete PostgreSQL migration chain | Passed in PGlite, including auth/RLS permission scenarios, repeated operation IDs, stable draft UUIDs across different operation IDs without consuming another invoice number, old-backup resurrection protection, changed-payload rejection, draft updates, stale versions, issued-invoice protection and cross-business denial |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm run build` | Production Next.js and shared workspace build passed |
| Browser offline suite | Chrome headless passed with both browser offline emulation and a deliberately unavailable HTTP transport |
| Restart persistence | Browser process closed and reopened with the same isolated profile; customer, draft, queue and recovery data retained |
| Offline navigation | Unknown app navigation while disconnected returned the cached device workspace |
| Update protection | New worker waited; refresh action blocked with unsaved-work flag, then applied only after explicit confirmation |
| Manifest/icons | Stable ID/start/scope and actual PNG dimensions verified |
| `npm run desktop:pack` | Windows x64 application directory built |
| `npm run desktop:dist` | Unsigned Windows x64 NSIS installer built; no installation or release publication performed |
| Desktop archive inspection | Main, preload and shared renderer assets present; no environment files or Next.js server source included |
| Production dependency audit | `npm audit --omit=dev`: zero findings after updates |
| Full dependency audit | 13 moderate findings in development/packaging dependencies (minimatch chain); no high/critical findings. No forced major downgrade/override applied |

Windows candidate output is `dist-desktop/MfaroInvoice Setup 0.1.0.exe`. Generated installers and static bundles are ignored by Git and reproduced from the committed sources and lockfile. This is an unsigned test candidate, not a production release.

## Verification blocked or not performed

**Electron runtime:** both development and packaged launch checks were attempted with the renderer sandbox enabled. Windows stopped Electron before the interface loaded because the execution environment's AppContainer ACL does not grant its sandbox token access to the executable directory. A narrow local ACL adjustment did not resolve the environment restriction. OS credential encryption also reported an unavailable system facility. The sandbox was not disabled. Consequently native desktop launch, actual Electron renderer isolation, OS credential persistence, native dialogs, printing and PDF output are **not runtime-verified** here. Static security tests and packaging passed; they are not a replacement for a real launch test.

**Platforms/devices:** no macOS/Linux installers were built or launched locally; their CI jobs are configured but have not been run. No physical Android, iPhone, iPad or installed browser-PWA mode was tested. Chrome automation verified the browser workspace and worker, not an OS home-screen install. Safari's print/share flow, real printer output, Linux keyring behaviour, macOS signing/notarisation and OS installation/uninstallation still require checks on those systems.

**Live backend:** the new SQL was tested in isolated PostgreSQL, not applied to production. Existing live Supabase users, MFA, Storage downloads and end-to-end cloud sync were not exercised with customer accounts. Server-side receipt locking uses PostgreSQL transaction/advisory locks; tests cover retry outcomes but not a distributed load test against the hosted database.

## Rollout prerequisites

1. Review and apply `20261105055420_offline_workspace_sync.sql` to the intended Supabase environment, reconcile migration history, and run hosted tenant/MFA tests with disposable accounts.
2. Test cloud download → airplane mode → draft creation → restart → reconnect, with two devices editing the same draft. Confirm one invoice number per queued create and explicit conflict resolution.
3. Build/install candidates on Windows, macOS and Linux outside this restricted execution environment. Verify launch without internet, OS data persistence, sandbox isolation, native dialogs, PDF contents and a real print job.
4. Run Android Chrome, iPhone/iPad Safari and desktop install/update checks. Confirm unsaved drafts survive an application update and logout erasure affects only the selected account.
5. Configure real public project variables for desktop CI, then supply secure signing/notarisation secrets for an authorised release. Version the application before distribution. Select and authorise an update provider before adding any automatic feed.

Setup, offline semantics, backup limitations, security boundaries and commands: [OFFLINE_DESKTOP.md](OFFLINE_DESKTOP.md).
