# Security architecture

MfaroInvoice uses Supabase Auth and PostgreSQL RLS as the authorization boundary. Every business-owned row has a non-null `business_id`; all browser access uses the publishable Supabase key and is constrained by active membership policies. The service-role key is server-only and must never be used for ordinary user requests.

The membership and permission helpers use `SECURITY DEFINER` only for authorization lookup, revoke default privileges, and fix `search_path`. RLS validates both existing rows (`USING`) and submitted rows (`WITH CHECK`). Per-user permission overrides take precedence over role defaults. Cross-tenant invoice/client, invoice-item, payment/invoice, and document/path references are blocked by database triggers. Storage is private, restricted to an approved MIME allowlist and 10 MB limit, and scoped to a validated business UUID path.

The service worker caches only public static assets; it never caches HTML, RSC/API responses, or any request with authentication headers. Session refresh uses Next.js 16's `proxy.ts` and Supabase's signature-verified claims.

Secrets belong in managed server-side environment variables. Enforce HTTPS, short-lived signed document URLs, provider-webhook signature verification and idempotency keys. Log security-relevant events without credentials or financial PII. Rotate secrets and revoke sessions during incident response.
