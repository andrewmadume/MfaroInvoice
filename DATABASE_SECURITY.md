# Tenant isolation

`business_users` links authenticated users to businesses. `has_permission(business_id, permission)` is the tenant predicate used by business-resource RLS. It derives the authenticated user from `auth.uid()`, checks active membership, then applies a business-specific permission override or a role default. A user never gains access by supplying a `business_id`: each read, write, update and delete is checked at the database layer.

Policies are enabled in the foundation migration and hardened in `0002_authorization_and_storage_hardening.sql`. Test two businesses, **Test Company Alpha** and **Test Company Beta**, with separate users and exercise direct REST requests, URL IDs, request body IDs and Storage paths. The expected result is no returned Beta records for Alpha and PostgreSQL `42501` for attempted writes. `npm run test:tenant` automates these checks against a configured Supabase project.
