# Inspection repairs

The repair migration is `20261021113718_correctness_and_authorization.sql`. Apply migrations in order. Migration filenames now match the versions recorded in the initialized Supabase project; their SQL contents are preserved. `20261021114006_explicit_rpc_access.sql` additionally restricts direct role grants inherited from Supabase defaults. See [current setup status](SUPABASE_SETUP.md).

| Inspection finding | Repair |
| --- | --- |
| Missing invoice notes | Added notes column |
| Payment enum assignment | Explicit invoice_status cast |
| Background actor failures | System history actor guarded by service-role authorization |
| Payment-intent isolation | RLS, tenant reads, revoked browser writes |
| MFA bypass through REST | Revoked membership/override writes and protected business columns |
| Existing-factor MFA | Session challenge/verification form and server refresh |
| Direct stock bypass | Column-level product grants; stock RPC only |
| Offline event failures | Captured form before await; initial queue load; error feedback |
| Payment precision | Currency-aware invoice total, checkout subunits and settlement comparison |
| Non-atomic settlement | One transaction, invoice/intent locks and idempotent payment reference |
| Paid/duplicate reminders | Paid reminders cancelled; leased claims; provider idempotency keys |
| Duplicate recurring runs | Due date checked again under row lock for scheduled runs |
| Fixed currency/tax | Business configuration passed into forms; stored invoice currency on documents |
| Draft/void receivables | Eligible status set in database financial summaries |
| Truncated summaries/exports | Database aggregates; exports advance through every API page |
| CSV formulas | Text prefix neutralization plus CSV quoting |
| Foreign project client | Composite business/client foreign key |

Additional repairs include scheduler-secret authentication, explicit POST payment-link forms, visible database read failures, corrected manifest dimensions, `.vercel` exclusion, executable database checks and PR validation CI. The obsolete GitHub Pages deployment is removed because the app requires a Node.js server.

## Deployment

1. Back up the database and apply the correctness-and-authorization migration after the six preceding migrations. Deploy the app and both Edge Functions together with this migration.
2. Set a strong, random `SCHEDULER_SECRET` as an Edge Function secret. Each scheduled POST must send `x-scheduler-secret` with that value. The handlers reject missing/incorrect secrets, including when gateway JWT verification is disabled as configured in `supabase/config.toml`.
3. Schedule automation-dispatcher for invoice generation/overdue updates and reminder-dispatcher for email delivery. The automation handler no longer sends emails. Reminder claims use five-minute leases, a stable Resend Idempotency-Key, and a retry window shorter than the provider's 24-hour idempotency retention. Failed/expired deliveries require investigation before manual retry.
4. Run `npm test`, the SQL assertions in `supabase/tests/tenant_isolation.sql`, and `npm run test:tenant` using isolated Alpha/Beta fixtures. Complete an end-to-end sandbox payment and email test with deployment credentials.

## Existing data

- Old invoices with fractional balances below the currency's smallest unit are rejected for online checkout with a reconciliation error. Historical financial records are not silently rewritten. Reconcile these exceptional legacy balances before issuing a new payment link.
- The project/client tenant constraint is initially NOT VALID, so new writes are checked while historical invalid links do not block deployment. Inspect existing rows, repair any foreign links, then run `alter table public.projects validate constraint projects_client_tenant;`.
- Stored invoice totals are rounded at the currency precision for new invoices and converted quotes. Line calculations retain four-decimal precision; the final payable total is rounded once.

## Validation

`npm test` executes the complete SQL migration chain in local PostgreSQL (PGlite), with small Auth/Storage schema stand-ins. Scenarios exercise invoice/quote creation, system actors, tenant isolation, direct-write restrictions, MFA, stock movements, repeated provider settlement, due-date/claim retries, and summaries over 1,000 records. JavaScript tests cover currency formatting, formula-safe CSV and paginated exports under a smaller API row cap.

These tests do not replace real Supabase Auth/Storage, provider sandbox, scheduler deployment, or browser acceptance tests. Live fixture credentials are not stored in the repository.
