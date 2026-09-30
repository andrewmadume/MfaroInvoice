# MfaroInvoice

Secure multi-tenant invoicing for African businesses. The repository starts with the highest-risk foundation: Supabase authentication boundaries, a responsive PWA shell, tenant-aware schema, PostgreSQL Row Level Security, private document storage policies, and tenant-isolation checks.

## Run locally

1. Copy `.env.example` to `.env.local` and fill in a Supabase project's URL, publishable key, and canonical application URL.
2. Install dependencies with `npm install`.
3. Apply every migration in `supabase/migrations` using Supabase CLI (`supabase db push`).
4. Run `npm run dev`.

The `SUPABASE_SERVICE_ROLE_KEY` is deliberately unused by browser code. Keep it server-only for exceptional administrative jobs, never normal user requests.

## Phase 3 operations

- Business-profile management, clients, multi-tenant dashboard, invoice numbering, VAT/discount line calculation, status tracking, and payment recording.
- Quote creation and transactional quote-to-invoice conversion.
- Printable invoice view for browser “Save as PDF”, web manifest, service worker, and install prompt on supported browsers.
- Financial documents are created only through transactional, permission-checked PostgreSQL RPCs; browser-submitted totals are recalculated by the database.
- Recurring-invoice templates, reminder queue/dispatcher, inventory movements, projects and time entries, reports, statements, Excel-compatible CSV exports, and private document uploads/downloads.
- Payment-provider preferences support Paystack and Flutterwave configuration, but live collection requires provider credentials and verified webhook deployment.

Deploy `supabase/functions/reminder-dispatcher` and schedule it through Supabase Cron or an authenticated scheduler to send due reminders. It requires `RESEND_API_KEY` and `REMINDER_FROM` as Edge Function secrets.

## Security verification

Create two real test users with separate **Test Company Alpha** and **Test Company Beta** businesses, seed the IDs named in `.env.example` as `SUPABASE_TEST_*`, then run `npm run test:tenant`. The script makes authenticated REST and Storage requests as both users and fails if either tenant can read or mutate the other tenant's data.

## Before production

Configure Supabase Auth redirect URLs and email verification, run the cross-tenant suite with real Alpha/Beta users, add a payment provider only behind verified and idempotent webhooks, and implement each business module through server-side validation and transactional RPCs. See `SECURITY.md` and `DATABASE_SECURITY.md`.
