# Security architecture

MfaroInvoice uses Supabase Auth and PostgreSQL RLS as the authorization boundary. Every business-owned row has a non-null `business_id`; all browser access uses the publishable Supabase key and is constrained by active membership policies. The service-role key is server-only and must never be used for ordinary user requests.

The membership helper functions use `SECURITY DEFINER` only for membership lookup, revoke default privileges, and fix `search_path`. RLS validates both existing rows (`USING`) and submitted rows (`WITH CHECK`). Cross-tenant invoice/client and invoice-item references are blocked by database triggers. Storage is private and scoped to a business UUID path.

Secrets belong in managed server-side environment variables. Enforce HTTPS, short-lived signed document URLs, provider-webhook signature verification and idempotency keys. Log security-relevant events without credentials or financial PII. Rotate secrets and revoke sessions during incident response.
