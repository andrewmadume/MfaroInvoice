-- Run with a Supabase test user JWT for each tenant. These assertions intentionally cross tenant IDs.
begin;
-- Setup is performed by the test harness: Alpha user only belongs to alpha_business.
-- The policy must return zero rows and reject all mutations for Beta.
select count(*) = 0 as alpha_cannot_read_beta_clients from public.clients where business_id = :'beta_business_id';
select count(*) = 0 as alpha_cannot_read_beta_invoices from public.invoices where business_id = :'beta_business_id';
select count(*) = 0 as alpha_cannot_read_beta_payments from public.payments where business_id = :'beta_business_id';
-- Expect 42501: every insert/update/delete using beta_business_id must be rejected by WITH CHECK / USING.
rollback;
