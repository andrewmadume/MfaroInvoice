-- Execute after migrations as the database owner; makes no persistent changes.
-- Behavioral checks: npm test (isolated PostgreSQL), npm run test:tenant (live fixtures).
begin;
do $$
begin
  if not (select relrowsecurity from pg_class where oid='public.payment_intents'::regclass) then
    raise exception 'payment intent RLS is disabled';
  end if;
  if has_table_privilege('authenticated','public.payment_intents','UPDATE')
     or has_table_privilege('authenticated','public.business_users','UPDATE')
     or has_table_privilege('authenticated','public.business_user_permissions','INSERT')
     or has_column_privilege('authenticated','public.products','stock_on_hand','UPDATE')
     or has_column_privilege('authenticated','public.businesses','mfa_required','UPDATE') then
    raise exception 'protected direct write privileges remain';
  end if;
  if has_function_privilege('authenticated','public.finalize_provider_payment(text,text,numeric,text,timestamptz)','EXECUTE') then
    raise exception 'provider finalization is callable by normal users';
  end if;
end $$;
rollback;
