-- Supabase can assign EXECUTE directly to API roles, independently of PUBLIC.
-- Restrict only application functions; preserve unrelated extension functions.
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as signature,p.proname
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname = any(array[
      'is_active_member','has_business_role','has_permission','create_business',
      'assert_same_invoice_tenant','assert_invoice_client_tenant','assert_payment_tenant',
      'storage_object_business_id','assert_document_tenant','set_updated_at',
      'next_document_number','create_invoice','send_invoice','record_payment',
      'create_quote','convert_quote_to_invoice','assert_recurring_item_tenant',
      'assert_inventory_tenant','assert_time_project_tenant','adjust_inventory',
      'run_recurring_invoice','create_recurring_invoice','has_aal2',
      'set_business_mfa_requirement','manage_business_user_access','apply_sync_operation',
      'activate_pending_memberships','create_payment_intent','guard_history_actor',
      'currency_decimals','finalize_provider_payment','claim_invoice_reminders','financial_summary'
    ])
  loop
    execute format('revoke execute on function %s from public, anon',fn.signature);
    if fn.proname like 'assert_%' or fn.proname in ('set_updated_at','next_document_number','guard_history_actor') then
      execute format('revoke execute on function %s from authenticated',fn.signature);
    end if;
  end loop;
end $$;
