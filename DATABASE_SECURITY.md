# Tenant isolation

`business_users` links authenticated users to businesses. `is_active_member(business_id)` is the single tenant predicate used by RLS. A user never gains access by supplying a `business_id`: each read, write, update and delete is checked against the current `auth.uid()` at the database layer.

Policies are enabled on all business tables in the first migration. Test two businesses, **Test Company Alpha** and **Test Company Beta**, with separate users and exercise direct REST requests, URL IDs, request body IDs and Storage paths. The expected result is no returned Beta records for Alpha and PostgreSQL `42501` for attempted writes.
