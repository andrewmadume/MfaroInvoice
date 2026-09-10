# MfaroInvoice

Secure multi-tenant invoicing for African businesses. The repository starts with the highest-risk foundation: Supabase authentication boundaries, a responsive PWA shell, tenant-aware schema, PostgreSQL Row Level Security, private document storage policies, and tenant-isolation checks.

## Run locally

1. Copy `.env.example` to `.env.local` and fill in a Supabase project's URL and publishable key.
2. Install dependencies with `npm install`.
3. Apply `supabase/migrations/0001_secure_foundation.sql` using Supabase CLI (`supabase db push`).
4. Run `npm run dev`.

The `SUPABASE_SERVICE_ROLE_KEY` is deliberately unused by browser code. Keep it server-only for exceptional administrative jobs, never normal user requests.

## Current foundation

- Branded mobile-responsive landing, sign-in/register routes, dashboard guard, web manifest, and offline shell service worker.
- UUID relational schema for businesses, memberships, clients, products, invoices, invoice items, payments, and audit logs.
- `NUMERIC(19,4)` money columns, database integrity constraints, tenant-reference triggers, role-scoped RLS, private Storage policies, and a controlled business-onboarding RPC.
- Cross-tenant verification starter at `supabase/tests/tenant_isolation.sql`.

## Before production

Configure Supabase Auth redirect URLs and email verification, run the cross-tenant suite with real Alpha/Beta users, add a payment provider only behind verified and idempotent webhooks, and implement each business module through server-side validation and transactional RPCs. See `SECURITY.md` and `DATABASE_SECURITY.md`.
