# Production deployment

MfaroInvoice is a server-rendered Next.js application. Deploy it to Vercel (or another Node.js host), not GitHub Pages. Its authenticated pages, server actions, API routes, payment webhooks, and Supabase session handling require a running server.

## One-time Vercel setup

1. Create a Vercel project from this GitHub repository. If the repository retains the current nested layout, set Vercel's **Root Directory** to `mfaro-invoice`; otherwise use the directory containing `package.json`.
2. Set the Production Branch to `main`.
3. Add the production environment variables listed below in Vercel. Do not put application credentials in source control or GitHub Actions secrets.
4. In Supabase Auth URL Configuration, set the Site URL to the final HTTPS production URL and add `<production-url>/auth/confirm` to Redirect URLs. Keep the same URL in `NEXT_PUBLIC_SITE_URL`.
5. Keep the Vercel Git integration connected to this repository. It automatically builds and deploys pushes to `main`; no GitHub CLI deployment secrets are required for that path. Review **Validate application** before merging, because Vercel Git deployments do not wait for that workflow unless deployment checks are configured separately. The optional manual CLI workflow below uses the GitHub `production` Environment, which can be protected with approval rules.

## Optional manual CLI deployment

The normal production path is Vercel’s Git integration. `.github/workflows/production-deploy.yml` runs only when **Manual production deployment** is dispatched in GitHub Actions. It is a fallback, not a second deployment on every push.

Configure all three repository secrets below before using that manual workflow. It fails immediately with the missing setting names if credentials are absent; it never prints their values. These secrets are not needed for automatic Git deployments.

| Secret | Purpose | Where to obtain it |
| --- | --- | --- |
| `VERCEL_TOKEN` | Allows the workflow to call the Vercel CLI | A Vercel access token |
| `VERCEL_ORG_ID` | Selects your Vercel account or team | `.vercel/project.json` after `vercel link` |
| `VERCEL_PROJECT_ID` | Selects this Vercel project | `.vercel/project.json` after `vercel link` |

Run `npx vercel link` locally once if you need to create/link the Vercel project. The generated `.vercel` directory is intentionally not committed.

## Vercel production environment variables

Set these in Vercel Project Settings → Environment Variables for **Production**. Public variables are delivered to the browser and therefore must never contain secrets.

| Variable | Required | Scope | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Public | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | Public | Supabase publishable/anon key |
| `NEXT_PUBLIC_SITE_URL` | Yes | Public | Final HTTPS app origin, with no trailing slash |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes for payment checkout/webhooks | Server only | Never prefix this with `NEXT_PUBLIC_` |
| `PAYSTACK_SECRET_KEY` | Only when Paystack is enabled | Server only | Used to create checkout sessions and verify webhooks |
| `FLUTTERWAVE_SECRET_KEY` | Only when Flutterwave is enabled | Server only | Used to create checkout sessions and verify webhooks |
| `FLUTTERWAVE_WEBHOOK_HASH` | Only when Flutterwave is enabled | Server only | Hash configured with Flutterwave for webhook verification |

`SUPABASE_TEST_*` values are test-fixture credentials only. Do not add them to Production. `APP_ENCRYPTION_KEY`, `PAYMENT_WEBHOOK_SECRET`, `RESEND_API_KEY`, and `REMINDER_FROM` are reserved for administrative or Supabase Edge Function operations; the current Next.js runtime does not read them. Configure `RESEND_API_KEY` and `REMINDER_FROM` as Supabase Edge Function secrets when deploying the reminder dispatcher, not as browser variables.

## Before enabling live payments

1. Apply all migrations in `supabase/migrations` to the production Supabase project.
2. Deploy the `reminder-dispatcher` and `automation-dispatcher` Supabase Edge Functions, then configure their schedules. Set a random `SCHEDULER_SECRET` as an Edge Function secret and send it as `x-scheduler-secret` on each scheduled POST. Automation generates invoices/overdue updates; only the reminder dispatcher sends email. Apply the correctness-and-authorization migration before deploying these handlers. See [repair deployment notes](REPAIRS.md).
3. Register these exact public webhook URLs with the provider:
   - `https://your-domain.example/api/webhooks/paystack`
   - `https://your-domain.example/api/webhooks/flutterwave`
4. Test provider signatures and an end-to-end payment in sandbox mode before enabling live credentials.

## Rollback

To roll back, revert the problematic commit on `main`; Vercel’s Git integration deploys the restored source. Check the new deployment’s status in Vercel. For an urgent rollback, use Vercel’s deployment history, then reconcile `main` so a later Git deployment does not restore the problem. The optional manual CLI workflow can redeploy checked-out source only after its three secrets are configured.
