# MfaroInvoice Supabase configuration

Project: `vbhlpehxoqiedyfcpmcm` (MfaroInvoice, eu-west-2).
API: `https://vbhlpehxoqiedyfcpmcm.supabase.co`.
Production app: `https://mfaro-invoice.vercel.app`.

## Configuration applied on 21 October 2026

- Initialized the empty database with the seven application migrations and an additional explicit RPC-access migration.
- Verified all 26 public application tables have RLS enabled. The private business-documents bucket allows the approved file types up to 10 MB.
- Restricted explicit anonymous function grants inherited from Supabase defaults; no application SECURITY DEFINER function is executable anonymously. Internal trigger/numbering functions are not callable by normal signed-in API clients.
- Renamed repository migration files to match the versions actually recorded in Supabase, preserving their SQL contents.
- Deployed automation-dispatcher and reminder-dispatcher with their scheduler-secret authentication guard.
- Configured the ignored local `.env.local` with the real project URL, browser-safe publishable key and localhost URL.
- Added `.env.production` containing only public browser configuration and the production site URL. Vercel project variables override these defaults. Never add server-side secrets to this tracked file.
- Fixed login redirects to retain session cookies and private/no-store headers.
- Verified the publishable key against Auth settings and a zero-row REST read. Email sign-up and email confirmation are enabled.
- Saved the Supabase Auth Site URL as `https://mfaro-invoice.vercel.app`, with exact production and localhost `/auth/confirm` redirect URLs.
- Corrected Vercel's production `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, which previously referenced another project. Added production `NEXT_PUBLIC_SITE_URL`.
- Enabled the hosted `pg_cron` and `pg_net` extensions (ninth migration). No background job is activated until scheduler authentication is verified.

## Dashboard configuration still required

The following remain dependent on server credentials or publication:

1. Add only exact intended preview redirect URLs if preview sign-up is required. Production and localhost redirects are already saved.
2. Save `SCHEDULER_SECRET` in this project's Edge Function secrets. The live endpoint still returned `503 Scheduler not configured` at verification, despite a reported save. Each trusted scheduled POST must send this value in `x-scheduler-secret`. After a successful authenticated smoke check, store the same value in Supabase Vault and schedule automation using `pg_cron` and `pg_net`. See https://supabase.com/docs/guides/functions/schedule-functions. Do not put a plaintext secret in cron SQL or Git.
3. For reminders, also set `RESEND_API_KEY` and a verified `REMINDER_FROM`. Schedule automation and reminder dispatch independently after configuring these secrets.
4. For payment checkout/webhooks, verify or replace Vercel's existing `SUPABASE_SERVICE_ROLE_KEY` with one from project `vbhlpehxoqiedyfcpmcm`, together with the enabled provider's secrets. Existing server secrets were not revealed or replaced. Never use a `NEXT_PUBLIC_` prefix for these. Payment-provider preferences are disabled by default in the empty database. Other old integration variables are unused by the current application.
5. Redeploy the application after merging the configuration changes. Existing Vercel environment overrides must refer to this same Supabase project and production website.

Do not paste private keys into issue comments or chat. Store them directly in the corresponding server/Edge Function environment.

## Security advisor interpretation

The anonymous SECURITY DEFINER execution warning is resolved. The remaining advisor warning identifies the intentionally callable authenticated RPCs; those functions enforce tenant permissions and, where appropriate, MFA within their bodies. See the advisor documentation: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
