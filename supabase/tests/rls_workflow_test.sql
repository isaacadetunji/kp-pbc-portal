-- =============================================================================
-- RLS + workflow tests. Runs as superuser for setup and switches to the
-- `authenticated` role with forged JWT claims to act as each user.
-- Any failed assertion raises and stops the run.
-- =============================================================================
\set ON_ERROR_STOP 1

-- helpers ---------------------------------------------------------------------
create or replace function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare v uuid;
begin
  reset role;
  select id into v from auth.users where email = p_email;
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, false);
  execute 'set role authenticated';
end $$;

create or replace function pg_temp.as_super() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', false);
end $$;

create or replace function pg_temp.assert(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'ASSERTION FAILED: %', p_msg; end if;
  raise notice 'ok - %', p_msg;
end $$;

-- expect an error whose message contains p_like
create or replace function pg_temp.expect_error(p_sql text, p_like text, p_msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ilike '%' || p_like || '%' then
      raise notice 'ok - % (rejected: %)', p_msg, sqlerrm;
      return;
    end if;
    raise exception 'ASSERTION FAILED: % — wrong error: %', p_msg, sqlerrm;
  end;
  raise exception 'ASSERTION FAILED: % — statement succeeded but should have failed', p_msg;
end $$;

grant execute on all functions in schema pg_temp to authenticated;

-- users -------------------------------------------------------------------------
insert into auth.users (email, raw_app_meta_data, raw_user_meta_data) values
  ('admin@kp.test',   '{"app_role":"admin"}', '{"full_name":"Ada Admin"}'),
  ('lead@kp.test',    '{"app_role":"staff"}', '{"full_name":"Lekan Lead"}'),
  ('manager@kp.test', '{"app_role":"staff"}', '{"full_name":"Mariam Manager"}'),
  ('member@kp.test',  '{"app_role":"staff"}', '{"full_name":"Musa Member"}'),
  ('outsider@kp.test','{"app_role":"staff"}', '{"full_name":"Olu Outsider"}'),
  ('cfo@client.test', '{}',                   '{"full_name":"Chioma CFO"}'),
  ('evil@other.test', '{"app_role":"client"}','{"full_name":"Eve Other"}'),
  ('hacker@x.test',   '{}',                   '{"full_name":"Self Signup"}');

select pg_temp.assert((select count(*) = 8 from public.profiles), 'profiles created by auth trigger');
select pg_temp.assert((select app_role = 'client' from public.profiles where email = 'hacker@x.test'),
  'user without app_metadata role defaults to client');

insert into public.clients (id, external_id, name, rc_number, tin, industry, year_end_month, year_end_day)
values ('11111111-1111-1111-1111-111111111111', 'EXT-1', 'Adebayo Foods Plc', 'RC123456', '12345678-0001', 'FMCG', 12, 31),
       ('22222222-2222-2222-2222-222222222222', 'EXT-2', 'Other Co Ltd', 'RC999', null, 'Other', 12, 31);
insert into public.client_contacts (client_id, full_name, email, is_primary)
values ('11111111-1111-1111-1111-111111111111', 'Chioma CFO', 'cfo@client.test', true),
       ('22222222-2222-2222-2222-222222222222', 'Eve Other', 'evil@other.test', true);
select pg_temp.assert((select count(*) = 2 from public.client_contacts where user_id is not null),
  'client contacts auto-linked to existing users by email');

-- create engagement as lead -------------------------------------------------------
select pg_temp.act_as('lead@kp.test');
select set_config('test.eng', public.create_engagement(
  '11111111-1111-1111-1111-111111111111',
  (select id from public.engagement_types where code = 'SA'),
  'Statutory audit FY2026', '2026-01-01', '2026-12-31',
  (select id from public.profiles where email = 'lead@kp.test'),
  array(select mi.id from public.master_checklist_items mi
        join public.master_item_engagement_types x on x.master_item_id = mi.id
        join public.engagement_types t on t.id = x.engagement_type_id and t.code = 'SA'),
  '2027-01-31',
  jsonb_build_array(
    jsonb_build_object('user_id', (select id from public.profiles where email = 'manager@kp.test'), 'team_role', 'manager'),
    jsonb_build_object('user_id', (select id from public.profiles where email = 'member@kp.test'), 'team_role', 'member'))
)::text, false);

select set_config('test.item', (select id::text from public.request_items where code = 'GEN-01'), false);
select pg_temp.assert((select code like 'SA-2026-0001' from public.engagements where id = current_setting('test.eng')::uuid),
  'engagement code generated SA-2026-0001');
select pg_temp.assert((select count(*) > 60 from public.request_items where engagement_id = current_setting('test.eng')::uuid),
  'request list generated from master checklist');
select pg_temp.assert((select count(*) >= 10 from public.engagement_folders where engagement_id = current_setting('test.eng')::uuid),
  'folders generated from default folders');
select pg_temp.assert((select count(*) = 3 from public.engagement_team where engagement_id = current_setting('test.eng')::uuid),
  'team created (lead, manager, member)');

-- client access is granted by default on creation (contacts with a portal account)
select pg_temp.assert((select count(*) = 1 from public.engagement_client_access a join public.client_contacts c on c.id = a.contact_id
  where a.engagement_id = current_setting('test.eng')::uuid and c.email = 'cfo@client.test'), 'client user granted access by default on creation');
insert into public.engagement_client_access (engagement_id, contact_id)
select current_setting('test.eng')::uuid, id from public.client_contacts where email = 'cfo@client.test'
on conflict do nothing;

-- visibility --------------------------------------------------------------------------
select pg_temp.act_as('cfo@client.test');
select pg_temp.assert((select count(*) = 1 and bool_and(status = 'draft') from public.engagements), 'client sees the DRAFT engagement shell ("being prepared")');
select pg_temp.assert((select count(*) = 0 from public.request_items) and (select count(*) = 0 from public.engagement_folders),
  'client sees no folders or items before release');

select pg_temp.act_as('outsider@kp.test');
select pg_temp.assert((select count(*) = 0 from public.engagements), 'staff not on the team cannot see engagement');
select pg_temp.expect_error($$select public.issue_request_list(current_setting('test.eng')::uuid)$$, 'not permitted',
  'outsider cannot issue request list');

select pg_temp.act_as('member@kp.test');
select pg_temp.expect_error($$select public.issue_request_list(current_setting('test.eng')::uuid)$$, 'not permitted',
  'team member cannot issue request list');

select pg_temp.act_as('lead@kp.test');
select public.issue_request_list(current_setting('test.eng')::uuid);
select pg_temp.assert((select status = 'pre_engagement' from public.engagements where id = current_setting('test.eng')::uuid),
  'issuing moves engagement to pre_engagement');

select pg_temp.act_as('cfo@client.test');
select pg_temp.assert((select count(*) = 1 from public.engagements), 'client sees issued engagement');
select pg_temp.assert((select count(*) > 60 from public.request_items), 'client sees request items');
select pg_temp.assert((select count(*) = 1 from public.notifications where type = 'request_list_issued'),
  'client notified that request list was issued');
select pg_temp.assert((select count(*) = 0 from public.status_history), 'client cannot read status history');
select pg_temp.assert((select count(*) = 0 from public.audit_log), 'client cannot read audit log');
select pg_temp.assert((select count(*) = 0 from public.master_checklist_items), 'client cannot read master checklist');
select pg_temp.assert((select count(*) = 1 from public.clients), 'client sees only its own client record');

select pg_temp.act_as('evil@other.test');
select pg_temp.assert((select count(*) = 0 from public.engagements), 'other client cannot see engagement');
select pg_temp.assert((select count(*) = 0 from public.request_items), 'other client cannot see items');
select pg_temp.expect_error($$select * from public.begin_upload(current_setting('test.item')::uuid, 'x.pdf', 'application/pdf', 100)$$,
  'not permitted', 'other client cannot upload to someone else''s item');
select pg_temp.expect_error($$select public.submit_item(current_setting('test.item')::uuid)$$,
  'not permitted', 'other client cannot submit someone else''s item');
select pg_temp.assert((select critical_total = 0 and outstanding = '[]'::jsonb from public.critical_gate(current_setting('test.eng')::uuid)),
  'critical_gate leaks nothing to other clients');

-- direct writes are blocked ----------------------------------------------------------------
select pg_temp.act_as('cfo@client.test');
select pg_temp.expect_error($$update public.request_items set status = 'accepted' where code = 'GEN-01'$$, 'permission denied',
  'client cannot update item status directly');
update public.request_items set title = 'hacked' where code = 'GEN-01';
select pg_temp.assert((select title <> 'hacked' from public.request_items where code = 'GEN-01'),
  'client cannot edit item fields (RLS filters the update)');
select pg_temp.expect_error($$insert into public.request_item_files (request_item_id, engagement_id, version_no, file_name, size_bytes, storage_path, uploaded_by)
  select id, engagement_id, 1, 'x.pdf', 1, 'x', auth.uid() from public.request_items limit 1$$, 'permission denied',
  'client cannot insert file rows directly');

select pg_temp.act_as('lead@kp.test');
select pg_temp.expect_error($$update public.request_items set status = 'accepted' where code = 'GEN-01'$$, 'permission denied',
  'even the lead cannot set status directly');
update public.request_items set due_date = '2026-10-15'
where engagement_id = current_setting('test.eng')::uuid and code = 'GEN-01';
select public.set_request_item_assignees((select id from public.request_items where code = 'GEN-01'), 'firm',
  array[(select id from public.profiles where email = 'member@kp.test')]);
select pg_temp.assert((select due_date = '2026-10-15' from public.request_items where code = 'GEN-01')
  and (select count(*) = 1 from public.request_item_assignees a join public.request_items i on i.id = a.request_item_id
       where i.code = 'GEN-01' and a.side = 'firm'), 'lead can set due date/assignee');

select pg_temp.act_as('member@kp.test');
update public.request_items set title = 'member edit' where code = 'GEN-02';
select pg_temp.assert((select title <> 'member edit' from public.request_items where code = 'GEN-02'),
  'team member cannot edit request list (RLS filters the update)');

-- upload + submit ------------------------------------------------------------------------------
select pg_temp.act_as('cfo@client.test');
select pg_temp.expect_error($$select * from public.begin_upload((select id from public.request_items where code='GEN-01'), 'malware.exe', 'application/octet-stream', 100)$$,
  'not allowed', 'disallowed file type rejected');
select pg_temp.expect_error($$select * from public.begin_upload((select id from public.request_items where code='GEN-01'), 'big.pdf', 'application/pdf', 500::bigint*1024*1024)$$,
  'larger than', 'oversize file rejected');
select pg_temp.expect_error($$select public.submit_item((select id from public.request_items where code='GEN-01'))$$,
  'upload at least one', 'cannot submit without files');

select set_config('test.f1', (select file_id::text from public.begin_upload(
  (select id from public.request_items where code='GEN-01'), 'CAC Certificate (2019).pdf', 'application/pdf', 20480)), false);
select pg_temp.assert((select storage_path = 'PBC/Adebayo Foods Plc/SA-2026-0001/01 Permanent File/GEN-01_CAC Certificate (2019)_v1.pdf'
  from public.request_item_files where id = current_setting('test.f1')::uuid), 'storage path follows convention');
select pg_temp.expect_error($$select public.complete_upload(current_setting('test.f1')::uuid, auth.uid(), 'abc')$$, 'permission denied',
  'client cannot mark an upload complete (server-verified only)');
select pg_temp.as_super();
select public.complete_upload(current_setting('test.f1')::uuid, (select id from auth.users where email='cfo@client.test'), 'abc123');
select pg_temp.act_as('cfo@client.test');
select pg_temp.assert(public.submit_item((select id from public.request_items where code='GEN-01'), 'Attached as requested') = 1,
  'submit creates version 1');
select pg_temp.assert((select status = 'submitted' from public.request_items where code='GEN-01'), 'item is submitted');
select pg_temp.expect_error($$select public.remove_draft_file(current_setting('test.f1')::uuid)$$, 'cannot be removed',
  'submitted files cannot be removed');

-- comments -----------------------------------------------------------------------------------------
insert into public.comments (request_item_id, author_id, body, is_internal)
values ((select id from public.request_items where code='GEN-01'), auth.uid(), 'Client trying internal', true);
select pg_temp.assert((select not is_internal from public.comments where body = 'Client trying internal'),
  'client comment forced to external');
select pg_temp.expect_error($$insert into public.comments (request_item_id, author_id, body) values ((select id from public.request_items where code='GEN-01'), (select id from public.profiles where email='lead@kp.test'), 'spoof')$$,
  'row-level security', 'client cannot post as someone else');

select pg_temp.act_as('member@kp.test');
select pg_temp.assert((select count(*) = 1 from public.notifications where type = 'item_submitted'),
  'assignee notified of submission');
insert into public.comments (request_item_id, author_id, body, is_internal, mentions)
values ((select id from public.request_items where code='GEN-01'), auth.uid(), 'Internal: check RC number', true,
        array[(select id from public.profiles where email='lead@kp.test'), (select id from public.profiles where email='cfo@client.test')]);
select pg_temp.assert((select mentions = array[(select id from public.profiles where email='lead@kp.test')] from public.comments where body like 'Internal:%'),
  'mentions filtered to team members');

select pg_temp.act_as('cfo@client.test');
select pg_temp.assert((select count(*) = 0 from public.comments where is_internal), 'client cannot see internal comments');
select pg_temp.assert((select count(*) = 2 from public.comments), 'client sees its own external comments');

select pg_temp.act_as('lead@kp.test');
select pg_temp.assert((select count(*) = 1 from public.notifications where type = 'mention'), 'lead notified of @mention');

-- review workflow ------------------------------------------------------------------------------------
select pg_temp.act_as('member@kp.test');
select public.review_item((select id from public.request_items where code='GEN-01'), 'start_review');
select pg_temp.expect_error($$select public.review_item((select id from public.request_items where code='GEN-01'), 'accept')$$,
  'restricted', 'team member cannot give final acceptance');
select pg_temp.expect_error($$select public.review_item((select id from public.request_items where code='GEN-01'), 'query', '')$$,
  'explain', 'query requires a note');
select public.review_item((select id from public.request_items where code='GEN-01'), 'query', 'Please provide the certified true copy.');

select pg_temp.act_as('cfo@client.test');
select pg_temp.assert((select status = 'queried' from public.request_items where code='GEN-01'), 'item queried');
select pg_temp.assert((select count(*) = 1 from public.notifications where type = 'item_queried'), 'client notified of query');
select set_config('test.f2', (select file_id::text from public.begin_upload(
  (select id from public.request_items where code='GEN-01'), 'CAC CTC.pdf', 'application/pdf', 1000)), false);
select pg_temp.as_super();
select public.complete_upload(current_setting('test.f2')::uuid, (select id from auth.users where email='cfo@client.test'));
select pg_temp.act_as('cfo@client.test');
select pg_temp.assert(public.submit_item((select id from public.request_items where code='GEN-01')) = 2,
  're-upload after query creates version 2');
select pg_temp.assert((select count(distinct version_no) = 2 from public.request_item_files
  where request_item_id = (select id from public.request_items where code='GEN-01')), 'previous version retained');

-- lead-only acceptance switch
select pg_temp.act_as('lead@kp.test');
update public.engagements set lead_only_acceptance = true where id = current_setting('test.eng')::uuid;
select pg_temp.act_as('manager@kp.test');
select pg_temp.expect_error($$select public.review_item((select id from public.request_items where code='GEN-01'), 'accept')$$,
  'restricted', 'manager blocked when acceptance is lead-only');
select pg_temp.act_as('lead@kp.test');
update public.engagements set lead_only_acceptance = false where id = current_setting('test.eng')::uuid;
select pg_temp.act_as('manager@kp.test');
select public.review_item((select id from public.request_items where code='GEN-01'), 'accept');
select pg_temp.assert((select status = 'accepted' from public.request_items where code='GEN-01'), 'manager accepted item');

-- N/A and waivers --------------------------------------------------------------------------------------------
select pg_temp.expect_error($$select public.review_item((select id from public.request_items where code='GEN-02'), 'not_applicable', 'n/a')$$,
  'cannot be marked n/a', 'critical items cannot be N/A');
select public.review_item((select id from public.request_items where code='REV-05'), 'not_applicable', 'No cut-off testing this year');
select pg_temp.assert((select status = 'not_applicable' from public.request_items where code='REV-05'), 'non-critical item marked N/A');
select pg_temp.expect_error($$select public.waive_item((select id from public.request_items where code='GEN-09'), 'Continuing client')$$,
  'only the engagement lead', 'manager cannot waive critical items');

select pg_temp.act_as('lead@kp.test');
select pg_temp.expect_error($$select public.waive_item((select id from public.request_items where code='GEN-09'), '  ')$$,
  'reason is required', 'waiver requires a reason');
select public.waive_item((select id from public.request_items where code='GEN-09'), 'Continuing client — no predecessor auditor');

-- critical gate (Pre-execution -> Execution) -------------------------------------------------------------------------
select pg_temp.expect_error($$select public.transition_engagement(current_setting('test.eng')::uuid, 'in_progress')$$,
  'critical item', 'Execution blocked while critical items are outstanding');
select pg_temp.expect_error($$select public.transition_engagement(current_setting('test.eng')::uuid, 'acceptance_review')$$,
  'cannot move', 'acceptance review is no longer part of the flow');
select pg_temp.act_as('member@kp.test');
select pg_temp.expect_error($$select public.transition_engagement(current_setting('test.eng')::uuid, 'in_progress')$$,
  'only a partner, the team lead or a manager', 'team member cannot move the stage');

-- satisfy remaining critical items (superuser shortcut for the test)
select pg_temp.as_super();
select set_config('app.workflow', 'on', false);
update public.request_items set status = 'accepted'
where engagement_id = current_setting('test.eng')::uuid and is_critical and not is_waived and status <> 'accepted';
select set_config('app.workflow', '', false);

select pg_temp.act_as('manager@kp.test');
select public.transition_engagement(current_setting('test.eng')::uuid, 'in_progress');
select pg_temp.assert((select status = 'in_progress' and fieldwork_started_at is not null from public.engagements
  where id = current_setting('test.eng')::uuid), 'manager moved to Execution once the gate passed (no acceptance decision needed)');
select pg_temp.assert((select count(*) = 0 from public.acceptance_decisions where engagement_id = current_setting('test.eng')::uuid),
  'no acceptance decision was recorded');
select pg_temp.act_as('lead@kp.test');

-- dashboards --------------------------------------------------------------------------------------------------------------
select pg_temp.assert((select pct_critical = 100 and na_items = 1 and accepted_items >= 1
  from public.v_engagement_progress where engagement_id = current_setting('test.eng')::uuid), 'progress view figures');
select pg_temp.act_as('evil@other.test');
select pg_temp.assert((select count(*) = 0 from public.v_engagement_progress where total_items > 0), 'other client sees no progress rows');
select pg_temp.act_as('cfo@client.test');
select pg_temp.assert((select count(*) = 1 from public.v_engagement_progress where total_items > 0), 'client sees own progress');

-- master checklist versioning --------------------------------------------------------------------------------------------
select pg_temp.act_as('lead@kp.test');
update public.master_checklist_items set title = 'lead edit' where code = 'GEN-03';
select pg_temp.as_super();
select pg_temp.assert((select title <> 'lead edit' from public.master_checklist_items where code = 'GEN-03'),
  'staff cannot edit the master checklist');

select pg_temp.act_as('admin@kp.test');
update public.master_checklist_items set guidance = 'Updated guidance: include all amendments.' where code = 'GEN-03';
select pg_temp.assert((select revision = 2 from public.master_checklist_items where code = 'GEN-03'), 'master edit bumps revision');
select pg_temp.assert((select count(*) > 0 from public.request_items), 'admin sees request items (view_all_engagements is on by default for admins)');
select pg_temp.act_as('lead@kp.test');
select pg_temp.assert((select guidance not like 'Updated%' from public.request_items
  where engagement_id = current_setting('test.eng')::uuid and code = 'GEN-03'), 'existing engagement NOT changed by master edit');
select pg_temp.assert((select count(*) = 1 from public.v_master_updates where engagement_id = current_setting('test.eng')::uuid),
  'engagement flagged: master updated');
select pg_temp.act_as('lead@kp.test');
select pg_temp.assert(public.pull_master_changes(current_setting('test.eng')::uuid) = 1, 'lead pulled master changes');
select pg_temp.assert((select guidance like 'Updated%' from public.request_items
  where engagement_id = current_setting('test.eng')::uuid and code = 'GEN-03'), 'item updated after pull');

-- custom items and deletion
select pg_temp.assert(public.add_request_item(current_setting('test.eng')::uuid,
  (select id from public.engagement_folders where engagement_id = current_setting('test.eng')::uuid and name = '14 Other'),
  'Schedule of donations', 'List all donations with receipts') is not null, 'custom item added');
select pg_temp.assert((select code = 'C-001' and issued_at is not null from public.request_items where title = 'Schedule of donations'),
  'custom item code C-001, issued immediately on a live engagement');
select public.delete_request_item((select id from public.request_items where title = 'Schedule of donations'));
select pg_temp.expect_error($$select public.delete_request_item((select id from public.request_items where code = 'GEN-01'))$$,
  'has uploaded files', 'cannot delete item that has files');

-- audit (read by the Super admin only; see Phase 1.3 below for the RLS checks)
select pg_temp.as_super();
select pg_temp.assert((select count(*) > 0 from public.audit_log where action = 'request_item.status_changed'), 'status changes audited');
select pg_temp.assert((select count(*) > 0 from public.audit_log where action = 'request_item.waived'), 'waiver audited');
select pg_temp.assert((select count(*) > 0 from public.audit_log where action = 'file.submitted'), 'file submission audited');
select pg_temp.assert((select count(*) > 0 from public.audit_log where action = 'request_item_assignee.insert'), 'assignment audited');
select pg_temp.expect_error($$delete from public.audit_log$$, 'append-only', 'audit log is append-only');
select pg_temp.assert((select count(*) >= 3 from public.status_history
  where entity_type = 'engagement' and engagement_id = current_setting('test.eng')::uuid), 'engagement status history recorded');

-- =============================================================================
-- Phase 1.1: super admin, approval, firm documents, sample schedules, groups
-- =============================================================================
select pg_temp.as_super();
insert into auth.users (email, raw_app_meta_data, raw_user_meta_data) values
  ('super@kp.test', '{"app_role":"super_admin"}', '{"full_name":"Sade Super"}');
select pg_temp.act_as('super@kp.test');
select pg_temp.assert(public.is_admin() and public.is_staff(), 'super admin counts as admin and staff');
select pg_temp.assert((select count(*) >= 1 from public.engagements), 'super admin sees all engagements');

-- approval: member prepares, lead approves
select pg_temp.act_as('lead@kp.test');
select set_config('test.eng2', public.create_engagement(
  '11111111-1111-1111-1111-111111111111', (select id from public.engagement_types where code = 'TX'),
  'Tax review FY2026', '2026-01-01', '2026-12-31', (select id from public.profiles where email = 'lead@kp.test'),
  array(select mi.id from public.master_checklist_items mi where mi.code like 'TAX-%'), null,
  jsonb_build_array(jsonb_build_object('user_id', (select id from public.profiles where email = 'member@kp.test'), 'team_role', 'member'))
)::text, false);
insert into public.engagement_client_access (engagement_id, contact_id)
select current_setting('test.eng2')::uuid, id from public.client_contacts where email = 'cfo@client.test'
on conflict do nothing;

select pg_temp.act_as('member@kp.test');
update public.request_items set due_date = '2026-11-30' where engagement_id = current_setting('test.eng2')::uuid;
select pg_temp.assert((select bool_and(due_date = '2026-11-30') from public.request_items where engagement_id = current_setting('test.eng2')::uuid),
  'preparer (team member) can edit a DRAFT request list');
select pg_temp.expect_error($$select public.issue_request_list(current_setting('test.eng2')::uuid)$$, 'not permitted',
  'preparer cannot release the list');
select public.submit_list_for_approval(current_setting('test.eng2')::uuid, 'Ready for your review');
select pg_temp.assert((select status = 'awaiting_approval' from public.engagements where id = current_setting('test.eng2')::uuid),
  'list submitted for approval');
update public.request_items set title = 'changed after submit' where engagement_id = current_setting('test.eng2')::uuid and code = 'TAX-02';
select pg_temp.assert((select title <> 'changed after submit' from public.request_items where engagement_id = current_setting('test.eng2')::uuid and code = 'TAX-02'),
  'preparer cannot edit while awaiting approval');

select pg_temp.act_as('cfo@client.test');
select pg_temp.assert((select count(*) = 1 from public.engagements where id = current_setting('test.eng2')::uuid),
  'client sees the shell of an engagement awaiting approval');
select pg_temp.assert((select count(*) = 0 from public.request_items where engagement_id = current_setting('test.eng2')::uuid),
  'client cannot see the items of a list awaiting approval');

select pg_temp.act_as('lead@kp.test');
select pg_temp.assert((select count(*) = 1 from public.notifications where type = 'approval_requested'), 'lead notified of approval request');
select pg_temp.expect_error($$select public.return_list_to_preparer(current_setting('test.eng2')::uuid, '')$$, 'what to change',
  'return requires a note');
select public.return_list_to_preparer(current_setting('test.eng2')::uuid, 'Add transfer pricing items');
select pg_temp.act_as('member@kp.test');
select pg_temp.assert((select count(*) = 1 from public.notifications where type = 'approval_returned'), 'preparer notified of return');
select public.submit_list_for_approval(current_setting('test.eng2')::uuid);
select pg_temp.act_as('lead@kp.test');
select public.issue_request_list(current_setting('test.eng2')::uuid);
select pg_temp.assert((select status = 'pre_engagement' and approved_by is not null from public.engagements where id = current_setting('test.eng2')::uuid),
  'reviewer approval releases the list and records the approver');

-- firm documents
select pg_temp.act_as('member@kp.test');
select set_config('test.item2', (select id::text from public.request_items where engagement_id = current_setting('test.eng2')::uuid and code = 'TAX-03'), false);
select set_config('test.fd', (select file_id::text from public.begin_upload(current_setting('test.item2')::uuid,
  'Selected samples.xlsx', 'application/vnd.ms-excel', 5000, 'firm_document')), false);
select pg_temp.as_super();
select public.complete_upload(current_setting('test.fd')::uuid, (select id from auth.users where email = 'member@kp.test'));
select pg_temp.act_as('cfo@client.test');
select pg_temp.assert((select count(*) = 1 from public.request_item_files where id = current_setting('test.fd')::uuid and kind = 'firm_document'),
  'client sees document shared by the firm');
select pg_temp.assert((select status = 'requested' from public.request_items where id = current_setting('test.item2')::uuid),
  'sharing a firm document does not change the item status');
select pg_temp.expect_error($$select * from public.begin_upload(current_setting('test.item2')::uuid, 'x.pdf', 'application/pdf', 10, 'firm_document')$$,
  'only the engagement team', 'client cannot upload as the firm');

-- sample schedules
select pg_temp.act_as('member@kp.test');
select set_config('test.sch', public.create_sample_schedule(current_setting('test.item2')::uuid,
  array['Date','Invoice no.','Customer','Amount (NGN)'],
  '[["2026-01-05","INV-1001","Shoprite","1,250,000"],["2026-02-11","INV-1044","Spar","980,500"],["2026-03-20","INV-1102","Justrite","2,100,000"],["","","",""]]'::jsonb,
  'Revenue samples', 'Provide invoice, delivery note and proof of payment')::text, false);
select pg_temp.assert((select count(*) = 3 from public.sample_lines where schedule_id = current_setting('test.sch')::uuid),
  'schedule created from pasted rows (blank rows skipped)');
select pg_temp.assert(public.add_sample_lines(current_setting('test.sch')::uuid, '[["2026-04-02","INV-1150","Ebeano","400,000","extra col ignored"]]'::jsonb) = 1,
  'lines appended; extra cells trimmed to the schedule columns');
select pg_temp.expect_error($$select public.set_sample_line_status(array(select id from public.sample_lines where line_no = 1 and schedule_id = current_setting('test.sch')::uuid), 'queried', ' ')$$,
  'explain what is missing', 'line query needs a note');

select pg_temp.act_as('cfo@client.test');
select pg_temp.assert((select count(*) = 4 from public.sample_lines where schedule_id = current_setting('test.sch')::uuid), 'client sees sample lines');
select set_config('test.line1', (select id::text from public.sample_lines where schedule_id = current_setting('test.sch')::uuid and line_no = 1), false);
select set_config('test.lf', (select file_id::text from public.begin_upload(current_setting('test.item2')::uuid,
  'INV-1001.pdf', 'application/pdf', 2000, 'sample_support', current_setting('test.line1')::uuid)), false);
select pg_temp.as_super();
select public.complete_upload(current_setting('test.lf')::uuid, (select id from auth.users where email = 'cfo@client.test'));
select pg_temp.act_as('cfo@client.test');
select pg_temp.assert((select status = 'provided' from public.sample_lines where id = current_setting('test.line1')::uuid),
  'uploading to a line marks it provided');
select pg_temp.assert(public.set_sample_line_status(array(select id from public.sample_lines where schedule_id = current_setting('test.sch')::uuid and line_no = 2), 'provided', 'Sent by courier') = 1,
  'client can flag a line as provided with a note');
select pg_temp.expect_error($$select public.set_sample_line_status(array[current_setting('test.line1')::uuid], 'received')$$,
  'only mark', 'client cannot mark a line received');
insert into public.comments (request_item_id, sample_line_id, author_id, body)
values (current_setting('test.item2')::uuid, current_setting('test.line1')::uuid, auth.uid(), 'Only 50% invoiced; balance in March');

select pg_temp.act_as('lead@kp.test');
select pg_temp.assert((select count(*) = 2 from public.notifications where type = 'sample_provided'), 'lead (no assignee) notified of upload and flag');
select pg_temp.act_as('member@kp.test');
select public.set_sample_line_status(array[current_setting('test.line1')::uuid], 'received');
select public.set_sample_line_status(array(select id from public.sample_lines where schedule_id = current_setting('test.sch')::uuid and line_no = 2),
  'queried', 'Internal document only; provide the third-party invoice');
select pg_temp.assert((select received_lines = 1 and queried_lines = 1 and outstanding_lines = 2 from public.v_sample_progress
  where schedule_id = current_setting('test.sch')::uuid), 'sample progress view counts by status');
select pg_temp.assert((select count(*) = 3 from public.comments where sample_line_id is not null), 'line comments recorded (client flag note, client comment, team query)');
select pg_temp.expect_error($$select public.delete_sample_line(current_setting('test.line1')::uuid)$$, 'has files',
  'cannot delete a line with files');

select pg_temp.act_as('cfo@client.test');
select pg_temp.expect_error($$select public.remove_draft_file(current_setting('test.lf')::uuid)$$, 'marked received',
  'files on a received line are kept');
select pg_temp.assert((select count(*) = 1 from public.notifications where type = 'sample_queried'), 'client notified of line query');

select pg_temp.act_as('evil@other.test');
select pg_temp.assert((select count(*) = 0 from public.sample_lines), 'other client cannot see sample lines');

-- groups
select pg_temp.as_super();
insert into public.client_groups (id, name) values ('33333333-3333-3333-3333-333333333333', 'Adebayo Group');
update public.clients set group_id = '33333333-3333-3333-3333-333333333333' where id = '11111111-1111-1111-1111-111111111111';
select pg_temp.act_as('cfo@client.test');
select pg_temp.assert((select count(*) = 1 from public.client_groups), 'client sees its own group');
select pg_temp.act_as('evil@other.test');
select pg_temp.assert((select count(*) = 0 from public.client_groups), 'other client cannot see the group');

-- =============================================================================
-- Phase 1.2: engagement workspace (shell visibility, planned dates, calendar,
-- additional documents, 50-column sample schedules)
-- =============================================================================
select pg_temp.as_super();
insert into auth.users (email, raw_app_meta_data, raw_user_meta_data) values
  ('fc@client.test', '{}', '{"full_name":"Femi Controller"}');
insert into public.client_contacts (client_id, full_name, email, position)
values ('11111111-1111-1111-1111-111111111111', 'Femi Controller', 'fc@client.test', 'Financial Controller'),
       ('11111111-1111-1111-1111-111111111111', 'No Account Yet', 'later@client.test', 'Accountant');

-- default access + planned dates
select pg_temp.act_as('lead@kp.test');
select set_config('test.eng3', public.create_engagement(
  '11111111-1111-1111-1111-111111111111', (select id from public.engagement_types where code = 'SA'),
  'Statutory audit FY2027', '2027-01-01', '2027-12-31', (select id from public.profiles where email = 'lead@kp.test'),
  array(select id from public.master_checklist_items where code like 'GEN-%'), null,
  jsonb_build_array(jsonb_build_object('user_id', (select id from public.profiles where email = 'member@kp.test'), 'team_role', 'member')),
  '2027-11-01', '2028-01-31', '2028-03-31', null)::text, false);
select pg_temp.assert((select planned_start = '2027-11-01' and documents_due = '2028-01-31' and report_due = '2028-03-31'
  from public.engagements where id = current_setting('test.eng3')::uuid), 'planned dates stored on creation');
select pg_temp.assert((select count(*) = 2 from public.engagement_client_access where engagement_id = current_setting('test.eng3')::uuid),
  'every client contact WITH a portal account is granted access by default (not the one without)');
select set_config('test.eng4', public.create_engagement(
  '11111111-1111-1111-1111-111111111111', (select id from public.engagement_types where code = 'AD'),
  'Advisory', null, '2027-12-31', (select id from public.profiles where email = 'lead@kp.test'),
  '{}'::uuid[], null, '[]'::jsonb, null, null, null, '{}'::uuid[])::text, false);
select pg_temp.assert((select count(*) = 0 from public.engagement_client_access where engagement_id = current_setting('test.eng4')::uuid),
  'unticking every contact in the wizard grants nobody');
select pg_temp.expect_error($$select public.create_engagement('11111111-1111-1111-1111-111111111111', (select id from public.engagement_types where code = 'AD'),
  'Bad dates', null, '2027-12-31', auth.uid(), '{}'::uuid[], null, '[]'::jsonb, null, '2028-02-01', '2028-01-01', null)$$,
  'cannot be before', 'report due date cannot precede documents due date');
update public.engagements set report_due = '2028-04-15' where id = current_setting('test.eng3')::uuid;
select pg_temp.assert((select report_due = '2028-04-15' from public.engagements where id = current_setting('test.eng3')::uuid),
  'lead can edit planned dates in settings');

-- client sees the shell of the draft, nothing inside it
select pg_temp.act_as('cfo@client.test');
select pg_temp.assert((select count(*) = 1 from public.engagements where id = current_setting('test.eng3')::uuid and status = 'draft'),
  'client sees unreleased engagement shell');
select pg_temp.assert((select count(*) = 0 from public.engagement_folders where engagement_id = current_setting('test.eng3')::uuid)
  and (select count(*) = 0 from public.request_items where engagement_id = current_setting('test.eng3')::uuid),
  'client sees zero folders and items on the unreleased engagement');
select pg_temp.assert((select count(*) = 0 from public.v_folder_progress where engagement_id = current_setting('test.eng3')::uuid)
  and (select total_items = 0 from public.v_engagement_progress where engagement_id = current_setting('test.eng3')::uuid),
  'progress views reveal nothing about the unreleased list');
select pg_temp.assert((select count(*) = 2 from public.engagement_team where engagement_id = current_setting('test.eng3')::uuid),
  'client sees the engagement team before release');
select pg_temp.assert((select count(*) = 1 from public.profiles where email = 'member@kp.test'),
  'client can read the profile of a team member on an unreleased engagement');
select pg_temp.assert((select count(*) = 1 from public.client_contacts where email = 'fc@client.test')
  and (select count(*) = 0 from public.client_contacts where email = 'later@client.test'),
  'client sees fellow client users on the engagement, not other contacts');
select pg_temp.expect_error($$select * from public.begin_document_upload(current_setting('test.eng3')::uuid, 'early.pdf', 'application/pdf', 100)$$,
  'not permitted', 'client cannot upload documents before release');
select pg_temp.expect_error($$select * from public.begin_upload((select id from public.request_items where engagement_id = current_setting('test.eng3')::uuid limit 1), 'x.pdf', 'application/pdf', 10)$$,
  'not found', 'client cannot reach request items of an unreleased engagement');

select pg_temp.act_as('evil@other.test');
select pg_temp.assert((select count(*) = 0 from public.engagements where id = current_setting('test.eng3')::uuid)
  and (select count(*) = 0 from public.engagement_team where engagement_id = current_setting('test.eng3')::uuid)
  and (select count(*) = 0 from public.client_contacts where email = 'fc@client.test'),
  'other client sees nothing of the unreleased engagement');

-- revoked access hides the shell
select pg_temp.act_as('lead@kp.test');
update public.engagement_client_access set revoked_at = now()
where engagement_id = current_setting('test.eng3')::uuid and contact_id = (select id from public.client_contacts where email = 'fc@client.test');
select pg_temp.act_as('fc@client.test');
select pg_temp.assert((select count(*) = 0 from public.engagements where id = current_setting('test.eng3')::uuid),
  'revoked client no longer sees the shell');

-- calendar events
select pg_temp.act_as('lead@kp.test');
insert into public.engagement_events (engagement_id, title, kind, starts_on, notes)
values (current_setting('test.eng3')::uuid, 'CIT return filing (FIRS)', 'filing', '2028-06-30', 'Self-assessment deadline');
insert into public.engagement_events (engagement_id, title, kind, starts_on, visible_to_client)
values (current_setting('test.eng3')::uuid, 'Partner review (internal)', 'milestone', '2028-03-01', false);
select pg_temp.assert((select created_by = auth.uid() from public.engagement_events where title = 'CIT return filing (FIRS)'),
  'event creator recorded server-side');
select pg_temp.expect_error($$insert into public.engagement_events (engagement_id, title, kind, starts_on, ends_on)
  values (current_setting('test.eng3')::uuid, 'Backwards', 'meeting', '2028-03-02', '2028-03-01')$$, 'check constraint',
  'event end date cannot precede start date');
select pg_temp.act_as('member@kp.test');
insert into public.engagement_events (engagement_id, title, kind, starts_on, ends_on)
values (current_setting('test.eng3')::uuid, 'Interim fieldwork', 'meeting', '2027-11-10', '2027-11-14');
select pg_temp.assert((select count(*) = 3 from public.engagement_events where engagement_id = current_setting('test.eng3')::uuid),
  'team members can add events and see all of them');
update public.engagement_events set title = 'Interim fieldwork (on site)' where title = 'Interim fieldwork';
select pg_temp.assert((select count(*) = 1 from public.engagement_events where title = 'Interim fieldwork (on site)'), 'team can edit events');

select pg_temp.act_as('cfo@client.test');
select pg_temp.assert((select count(*) = 2 and bool_and(visible_to_client) from public.engagement_events where engagement_id = current_setting('test.eng3')::uuid),
  'client reads only client-visible events (also before release)');
select pg_temp.expect_error($$insert into public.engagement_events (engagement_id, title, kind, starts_on)
  values (current_setting('test.eng3')::uuid, 'Client event', 'meeting', '2028-01-01')$$, 'row-level security',
  'client cannot insert events');
update public.engagement_events set title = 'hacked' where engagement_id = current_setting('test.eng3')::uuid;
delete from public.engagement_events where engagement_id = current_setting('test.eng3')::uuid;
select pg_temp.as_super();
select pg_temp.assert((select count(*) = 3 and bool_and(title <> 'hacked') from public.engagement_events where engagement_id = current_setting('test.eng3')::uuid),
  'client cannot change or delete events');
select pg_temp.act_as('outsider@kp.test');
select pg_temp.assert((select count(*) = 0 from public.engagement_events), 'staff outside the team see no events');
select pg_temp.expect_error($$insert into public.engagement_events (engagement_id, title, kind, starts_on)
  values (current_setting('test.eng3')::uuid, 'Outsider', 'meeting', '2028-01-01')$$, 'row-level security',
  'staff outside the team cannot add events');
select pg_temp.act_as('evil@other.test');
select pg_temp.assert((select count(*) = 0 from public.engagement_events), 'other client sees no events');

-- additional documents (released engagement test.eng)
select pg_temp.act_as('cfo@client.test');
select pg_temp.expect_error($$select * from public.begin_document_upload(current_setting('test.eng')::uuid, 'tool.exe', 'application/octet-stream', 100)$$,
  'not allowed', 'document type validated against settings');
select pg_temp.expect_error($$select * from public.begin_document_upload(current_setting('test.eng')::uuid, 'huge.pdf', 'application/pdf', 900::bigint*1024*1024)$$,
  'larger than', 'document size validated against settings');
select set_config('test.cdoc', (select document_id::text from public.begin_document_upload(current_setting('test.eng')::uuid,
  'Board minutes Q4.pdf', 'application/pdf', 4096, 'Signed minutes approving the FS')), false);
select pg_temp.assert((select side = 'client' and storage_path = 'PBC/Adebayo Foods Plc/SA-2026-0001/_Additional documents/CLIENT_Board minutes Q4.pdf'
  from public.engagement_documents where id = current_setting('test.cdoc')::uuid), 'client upload is client-side; path under _Additional documents');
select pg_temp.expect_error($$select public.complete_document_upload(current_setting('test.cdoc')::uuid, auth.uid())$$, 'permission denied',
  'client cannot complete a document upload (server-verified only)');
select pg_temp.as_super();
select public.complete_document_upload(current_setting('test.cdoc')::uuid, (select id from auth.users where email = 'cfo@client.test'), 'abc');
select pg_temp.act_as('manager@kp.test');
select set_config('test.fdoc', (select document_id::text from public.begin_document_upload(current_setting('test.eng')::uuid,
  'Engagement letter.pdf', 'application/pdf', 2048)), false);
select pg_temp.assert((select side = 'firm' from public.engagement_documents where id = current_setting('test.fdoc')::uuid),
  'team upload is firm-side whatever the caller sends');
select pg_temp.as_super();
select public.complete_document_upload(current_setting('test.fdoc')::uuid, (select id from auth.users where email = 'manager@kp.test'));
select pg_temp.act_as('lead@kp.test');
select pg_temp.assert((select count(*) = 2 from public.engagement_documents where engagement_id = current_setting('test.eng')::uuid),
  'team sees documents from both sides');
select pg_temp.assert((select count(*) = 1 from public.notifications where type = 'document_uploaded'), 'team notified of client document');
select pg_temp.act_as('cfo@client.test');
select pg_temp.assert((select count(*) = 2 from public.engagement_documents), 'client sees documents from both sides');
select pg_temp.assert((select count(*) = 1 from public.notifications where type = 'document_shared'), 'client notified of firm document');
select pg_temp.expect_error($$select public.delete_engagement_document(current_setting('test.fdoc')::uuid)$$, 'not permitted',
  'client cannot delete a firm document');
select public.delete_engagement_document(current_setting('test.cdoc')::uuid);
select pg_temp.assert((select count(*) = 1 from public.engagement_documents), 'uploader soft-deletes own document (hidden from client)');
select pg_temp.act_as('member@kp.test');
select pg_temp.assert((select deleted_at is not null and deleted_by is not null from public.engagement_documents where id = current_setting('test.cdoc')::uuid),
  'team still sees the deleted document for the record');
select pg_temp.expect_error($$select public.delete_engagement_document(current_setting('test.fdoc')::uuid)$$, 'not permitted',
  'a team member cannot delete a colleague''s document');
select pg_temp.expect_error($$insert into public.engagement_documents (engagement_id, uploaded_by, side, file_name, size_bytes, storage_path)
  values (current_setting('test.eng')::uuid, auth.uid(), 'client', 'x.pdf', 1, 'x')$$, 'permission denied',
  'documents cannot be inserted directly');
select pg_temp.act_as('lead@kp.test');
select public.delete_engagement_document(current_setting('test.fdoc')::uuid);
select pg_temp.assert((select count(*) = 2 and bool_and(deleted_at is not null) from public.engagement_documents
  where engagement_id = current_setting('test.eng')::uuid), 'lead (manager role) can delete any document');
select pg_temp.act_as('outsider@kp.test');
select pg_temp.assert((select count(*) = 0 from public.engagement_documents), 'staff outside the team see no documents');
select pg_temp.expect_error($$select * from public.begin_document_upload(current_setting('test.eng')::uuid, 'x.pdf', 'application/pdf', 10)$$,
  'not permitted', 'staff outside the team cannot upload documents');
select pg_temp.act_as('evil@other.test');
select pg_temp.assert((select count(*) = 0 from public.engagement_documents), 'other client sees no documents');
select pg_temp.expect_error($$select * from public.begin_document_upload(current_setting('test.eng')::uuid, 'x.pdf', 'application/pdf', 10)$$,
  'not permitted', 'other client cannot upload documents');
select pg_temp.as_super();
select pg_temp.assert((select count(*) >= 2 from public.audit_log where entity_type = 'engagement_document')
  and (select count(*) >= 3 from public.audit_log where entity_type = 'engagement_event'), 'documents and events are audited');

-- sample schedules: 50 columns
select pg_temp.act_as('member@kp.test');
select set_config('test.sch50', public.create_sample_schedule(
  (select id from public.request_items where engagement_id = current_setting('test.eng')::uuid and code = 'GEN-04'),
  array(select 'Col ' || g from generate_series(1, 50) g),
  jsonb_build_array(to_jsonb(array(select 'v' || g from generate_series(1, 52) g))), 'Wide schedule')::text, false);
select pg_temp.assert((select cardinality(columns) = 50 from public.sample_schedules where id = current_setting('test.sch50')::uuid)
  and (select cardinality(cells) = 50 and cells[50] = 'v50' from public.sample_lines where schedule_id = current_setting('test.sch50')::uuid),
  'sample schedule with 50 columns works; extra cells trimmed to 50');
select pg_temp.expect_error($$select public.create_sample_schedule(
  (select id from public.request_items where engagement_id = current_setting('test.eng')::uuid and code = 'GEN-05'),
  array(select 'Col ' || g from generate_series(1, 51) g), '[]'::jsonb)$$, 'between 1 and 50',
  'a 51-column schedule is rejected');
select pg_temp.as_super();
select pg_temp.expect_error($$insert into public.sample_schedules (request_item_id, engagement_id, columns)
  select id, engagement_id, array(select 'c' || g from generate_series(1, 51) g) from public.request_items where code = 'GEN-05' limit 1$$,
  'check constraint', 'table constraint caps columns at 50');

-- =============================================================================
-- 0008 (Agent A): role permissions, engagement visibility, team roles,
-- request assignment & locking, stages, engagement codes
-- =============================================================================
select pg_temp.as_super();
insert into auth.users (email, raw_app_meta_data, raw_user_meta_data) values
  ('partner@kp.test', '{"app_role":"staff"}', '{"full_name":"Pat Partner"}'),
  ('junior@kp.test',  '{"app_role":"staff"}', '{"full_name":"Jide Junior"}');
-- user id by email, readable from any test role (profiles RLS hides other users from clients)
create or replace function pg_temp.uid(p_email text) returns uuid language sql security definer as $$
  select id from auth.users where email = p_email
$$;
grant execute on function pg_temp.uid(text) to authenticated;

-- permissions matrix & audit -----------------------------------------------------
select pg_temp.act_as('admin@kp.test');
select pg_temp.assert((select count(*) >= 1 from public.engagements), 'admin sees every engagement by default (view_all_engagements is on for admins)');
select pg_temp.assert((select count(*) = 0 from public.audit_log), 'admin cannot read the audit log');
select pg_temp.assert(not public.has_app_permission('manage_users') and not public.has_app_permission('manage_clients')
  and public.has_app_permission('manage_checklist') and public.has_app_permission('create_engagements')
  and public.has_app_permission('view_all_engagements'),
  'admin defaults: master checklist, create engagements and view all engagements');
update public.app_settings set value = jsonb_set(value, '{admin,view_all_engagements}', 'false') where key = 'role_permissions';
select pg_temp.assert((select count(*) >= 1 from public.engagements), 'admin cannot change its own permissions (settings are Super admin only, so view-all stays on)');
select pg_temp.expect_error($$insert into public.engagement_types (code, name, code_prefix) values ('ZZ', 'Nope', 'ZZ')$$,
  'row-level security', 'admin cannot add engagement types');
select pg_temp.act_as('super@kp.test');
select pg_temp.assert((select count(*) > 0 from public.audit_log), 'Super admin reads the audit log');
update public.app_settings set value = jsonb_set(value, '{admin,view_all_engagements}', 'true') where key = 'role_permissions';
select pg_temp.act_as('admin@kp.test');
select pg_temp.assert((select count(*) >= 4 from public.engagements) and (select count(*) > 0 from public.request_items),
  'Super admin switched on view_all_engagements: admin sees every engagement');
select pg_temp.assert(not public.can_manage_engagement(current_setting('test.eng')::uuid),
  'seeing every engagement does not make the admin a manager of it');
select pg_temp.expect_error($$insert into public.engagement_events (engagement_id, title, kind, starts_on)
  values (current_setting('test.eng')::uuid, 'Viewer event', 'meeting', '2028-01-01')$$, 'row-level security',
  'a viewer who is not on the team is read-only (no events)');
select pg_temp.expect_error($$insert into public.comments (request_item_id, author_id, body)
  values ((select id from public.request_items where engagement_id = current_setting('test.eng')::uuid and code = 'GEN-02'), auth.uid(), 'hi')$$,
  'row-level security', 'a viewer who is not on the team cannot comment');
select pg_temp.as_super();
update public.app_settings set value = jsonb_set(value, '{admin,view_all_engagements}', 'false') where key = 'role_permissions';
update public.app_settings set value = jsonb_set(value, '{staff,create_engagements}', 'false') where key = 'role_permissions';
select pg_temp.act_as('member@kp.test');
select pg_temp.expect_error($$select public.create_engagement('11111111-1111-1111-1111-111111111111',
  (select id from public.engagement_types where code = 'AD'), 'No', null, '2027-12-31',
  (select id from public.profiles where email = 'lead@kp.test'), '{}'::uuid[])$$,
  'permission to create', 'staff without create_engagements cannot create an engagement');
select pg_temp.as_super();
update public.app_settings set value = jsonb_set(value, '{staff,create_engagements}', 'true') where key = 'role_permissions';

-- creator visibility: the creator is NOT added to the team ----------------------
select pg_temp.act_as('admin@kp.test');
select set_config('test.a_eng', public.create_engagement(
  '11111111-1111-1111-1111-111111111111', (select id from public.engagement_types where code = 'DD'),
  'Due diligence 2028', null, '2028-06-30', (select id from public.profiles where email = 'lead@kp.test'),
  array(select id from public.master_checklist_items where code in ('GEN-01', 'GEN-02', 'FST-01')), null,
  jsonb_build_array(
    jsonb_build_object('user_id', (select id from public.profiles where email = 'partner@kp.test'), 'team_role', 'partner'),
    jsonb_build_object('user_id', (select id from public.profiles where email = 'manager@kp.test'), 'team_role', 'manager'),
    jsonb_build_object('user_id', (select id from public.profiles where email = 'member@kp.test'), 'team_role', 'member'),
    jsonb_build_object('user_id', (select id from public.profiles where email = 'junior@kp.test'), 'team_role', 'member')))::text, false);
select pg_temp.assert((select count(*) = 1 from public.engagements), 'creator sees the engagement they created (only that one)');
select pg_temp.assert((select count(*) = 0 from public.engagement_team where user_id = auth.uid())
  and (select count(*) = 5 from public.engagement_team where engagement_id = current_setting('test.a_eng')::uuid),
  'the creator is not added to the team; partner, lead, manager and members are');
select pg_temp.assert((select lead_id = (select id from public.profiles where email = 'lead@kp.test') from public.engagements
  where id = current_setting('test.a_eng')::uuid), 'chosen team lead recorded on the engagement');
select pg_temp.expect_error($$select public.issue_request_list(current_setting('test.a_eng')::uuid)$$, 'not permitted',
  'the creator (not on the team) cannot release the list');
select pg_temp.act_as('outsider@kp.test');
select pg_temp.assert((select count(*) = 0 from public.engagements where id = current_setting('test.a_eng')::uuid),
  'staff outside the team do not see it');
select pg_temp.expect_error($$select public.create_engagement('11111111-1111-1111-1111-111111111111',
  (select id from public.engagement_types where code = 'AD'), 'No lead', null, '2027-12-31', null, '{}'::uuid[])$$,
  'choose the team lead', 'a team lead is required');
select pg_temp.expect_error($$select public.create_engagement('11111111-1111-1111-1111-111111111111',
  (select id from public.engagement_types where code = 'AD'), 'Two leads', null, '2027-12-31',
  (select id from public.profiles where email = 'lead@kp.test'), '{}'::uuid[], null,
  jsonb_build_array(jsonb_build_object('user_id', auth.uid(), 'team_role', 'lead')))$$,
  'team roles must be', 'only one team lead can be chosen');

-- client contacts: manage_clients or the engagement's managers --------------------
select pg_temp.expect_error($$insert into public.client_contacts (client_id, full_name, email)
  values ('11111111-1111-1111-1111-111111111111', 'Nope', 'nope@client.test')$$, 'row-level security',
  'staff without manage_clients cannot add client contacts');
select pg_temp.act_as('manager@kp.test');
insert into public.client_contacts (client_id, full_name, email) values ('11111111-1111-1111-1111-111111111111', 'New Contact', 'new@client.test');
select pg_temp.assert((select count(*) = 1 from public.client_contacts where email = 'new@client.test'),
  'an engagement manager can add a contact of that client (invite flow)');

-- team roles ----------------------------------------------------------------------
select pg_temp.act_as('lead@kp.test');
select pg_temp.expect_error($$insert into public.engagement_team (engagement_id, user_id, team_role)
  values (current_setting('test.a_eng')::uuid, (select id from public.profiles where email = 'outsider@kp.test'), 'lead')$$,
  'row-level security', 'a second lead cannot be added directly');
select pg_temp.expect_error($$insert into public.engagement_team (engagement_id, user_id, team_role)
  values (current_setting('test.a_eng')::uuid, (select id from public.profiles where email = 'cfo@client.test'), 'member')$$,
  'only active firm users', 'client users cannot join the engagement team');
select pg_temp.as_super();
select pg_temp.expect_error($$insert into public.engagement_team (engagement_id, user_id, team_role)
  values (current_setting('test.a_eng')::uuid, (select id from public.profiles where email = 'outsider@kp.test'), 'lead')$$,
  'engagement_team_one_lead_uq', 'exactly one lead per engagement (unique index)');
select pg_temp.act_as('manager@kp.test');
select pg_temp.expect_error($$insert into public.engagement_team (engagement_id, user_id, team_role)
  values (current_setting('test.a_eng')::uuid, (select id from public.profiles where email = 'outsider@kp.test'), 'partner')$$,
  'row-level security', 'a manager cannot add a partner');
delete from public.engagement_team where engagement_id = current_setting('test.a_eng')::uuid
  and user_id = (select id from public.profiles where email = 'partner@kp.test');
select pg_temp.assert((select count(*) = 1 from public.engagement_team where engagement_id = current_setting('test.a_eng')::uuid
  and team_role::text = 'partner'), 'a manager cannot remove a partner');
select pg_temp.act_as('member@kp.test');
select pg_temp.expect_error($$select public.set_engagement_lead(current_setting('test.a_eng')::uuid, auth.uid())$$,
  'only a partner, the team lead or a manager', 'a team member cannot change the lead');
select pg_temp.act_as('manager@kp.test');
select public.set_engagement_lead(current_setting('test.a_eng')::uuid, (select id from public.profiles where email = 'member@kp.test'));
select pg_temp.assert((select team_role::text = 'lead' from public.engagement_team where engagement_id = current_setting('test.a_eng')::uuid
    and user_id = (select id from public.profiles where email = 'member@kp.test'))
  and (select team_role::text = 'manager' from public.engagement_team where engagement_id = current_setting('test.a_eng')::uuid
    and user_id = (select id from public.profiles where email = 'lead@kp.test'))
  and (select lead_id = (select id from public.profiles where email = 'member@kp.test') from public.engagements
    where id = current_setting('test.a_eng')::uuid),
  'manager changed the lead: previous lead became a manager, lead_id kept in sync');
select pg_temp.assert((select count(*) = 1 from public.engagement_team where engagement_id = current_setting('test.a_eng')::uuid
  and team_role = 'lead'), 'still exactly one lead');
select pg_temp.act_as('member@kp.test');
select pg_temp.assert((select count(*) = 1 from public.notifications where type = 'lead_assigned'), 'new lead notified');
select public.set_engagement_lead(current_setting('test.a_eng')::uuid, (select id from public.profiles where email = 'lead@kp.test'));
select pg_temp.act_as('lead@kp.test');
update public.engagement_team set team_role = 'member' where engagement_id = current_setting('test.a_eng')::uuid
  and user_id = (select id from public.profiles where email = 'member@kp.test');
select pg_temp.assert((select team_role::text = 'member' from public.engagement_team where engagement_id = current_setting('test.a_eng')::uuid
  and user_id = (select id from public.profiles where email = 'member@kp.test')), 'lead handed back; the lead changes a manager back to member');
select pg_temp.act_as('partner@kp.test');
select pg_temp.assert(public.is_engagement_lead(current_setting('test.a_eng')::uuid) and public.can_accept_items(current_setting('test.a_eng')::uuid),
  'partner has the lead''s powers');
select public.issue_request_list(current_setting('test.a_eng')::uuid);
select pg_temp.assert((select status = 'pre_engagement' from public.engagements where id = current_setting('test.a_eng')::uuid),
  'partner approved and released the list');
select public.waive_item((select id from public.request_items where engagement_id = current_setting('test.a_eng')::uuid and code = 'GEN-02'),
  'Obtained directly from CAC');
select pg_temp.assert((select is_waived from public.request_items where engagement_id = current_setting('test.a_eng')::uuid and code = 'GEN-02'),
  'partner waived a critical item');

-- assignment & locking ------------------------------------------------------------
select pg_temp.act_as('lead@kp.test');
select set_config('test.a_lock', public.add_request_item(current_setting('test.a_eng')::uuid,
  (select folder_id from public.request_items where engagement_id = current_setting('test.a_eng')::uuid and code = 'GEN-01'),
  'Directors'' remuneration schedule', 'Confidential', false, null, 'normal', null, '{}', true,
  array[(select id from public.profiles where email = 'member@kp.test')],
  array[(select id from public.profiles where email = 'cfo@client.test')])::text, false);
select set_config('test.a_open', public.add_request_item(current_setting('test.a_eng')::uuid,
  (select folder_id from public.request_items where engagement_id = current_setting('test.a_eng')::uuid and code = 'GEN-01'),
  'Board minutes', null)::text, false);
select pg_temp.assert((select is_locked and created_by = auth.uid() from public.request_items where id = current_setting('test.a_lock')::uuid)
  and (select count(*) = 2 from public.request_item_assignees where request_item_id = current_setting('test.a_lock')::uuid),
  'locked request created with a firm and a client assignee');
select pg_temp.assert((select bool_and(side = case when user_id = (select id from public.profiles where email = 'cfo@client.test') then 'client' else 'firm' end::public.document_side)
  from public.request_item_assignees where request_item_id = current_setting('test.a_lock')::uuid), 'assignee side derived from the user''s role');

select pg_temp.act_as('cfo@client.test');
select pg_temp.assert((select count(*) = 1 from public.request_items where id = current_setting('test.a_lock')::uuid),
  'client assignee sees the locked request');
select pg_temp.assert((select count(*) = 1 from public.notifications where type = 'item_assigned' and request_item_id = current_setting('test.a_lock')::uuid),
  'client assignee notified "Assigned to you"');
select set_config('test.a_f', (select file_id::text from public.begin_upload(current_setting('test.a_lock')::uuid,
  'Remuneration.pdf', 'application/pdf', 100)), false);
select pg_temp.as_super();
select public.complete_upload(current_setting('test.a_f')::uuid, (select id from auth.users where email = 'cfo@client.test'));
select pg_temp.act_as('cfo@client.test');
select public.submit_item(current_setting('test.a_lock')::uuid, 'Attached');
insert into public.comments (request_item_id, author_id, body) values (current_setting('test.a_lock')::uuid, auth.uid(), 'Please keep confidential');

select pg_temp.act_as('fc@client.test');
select pg_temp.assert((select count(*) = 0 from public.request_items where id = current_setting('test.a_lock')::uuid)
  and (select count(*) = 1 from public.request_items where id = current_setting('test.a_open')::uuid),
  'another client user does not see the locked request (but sees unlocked ones)');
select pg_temp.assert((select count(*) = 0 from public.request_item_files where request_item_id = current_setting('test.a_lock')::uuid)
  and (select count(*) = 0 from public.comments where request_item_id = current_setting('test.a_lock')::uuid)
  and (select count(*) = 0 from public.request_item_assignees where request_item_id = current_setting('test.a_lock')::uuid),
  'files, comments and assignees of a locked request are hidden from other client users');
select pg_temp.assert((select total_items from public.v_engagement_progress where engagement_id = current_setting('test.a_eng')::uuid) = 4,
  'progress view excludes the locked request for other client users');
select pg_temp.expect_error($$select * from public.begin_upload(current_setting('test.a_lock')::uuid, 'x.pdf', 'application/pdf', 10)$$,
  'not permitted', 'another client user cannot upload to the locked request');
select pg_temp.expect_error($$insert into public.comments (request_item_id, author_id, body) values (current_setting('test.a_lock')::uuid, auth.uid(), 'x')$$,
  'row-level security', 'another client user cannot comment on the locked request');
select pg_temp.act_as('cfo@client.test');
select pg_temp.assert((select total_items from public.v_engagement_progress where engagement_id = current_setting('test.a_eng')::uuid) = 5,
  'the client assignee''s progress includes it');

select pg_temp.act_as('member@kp.test');
select pg_temp.assert((select count(*) = 1 from public.request_items where id = current_setting('test.a_lock')::uuid)
  and (select count(*) = 1 from public.request_item_files where request_item_id = current_setting('test.a_lock')::uuid),
  'firm assignee sees the locked request and its files');
select pg_temp.assert((select count(*) = 1 from public.notifications where type = 'item_submitted' and request_item_id = current_setting('test.a_lock')::uuid),
  'firm assignee notified of the submission');
select pg_temp.act_as('junior@kp.test');
select pg_temp.assert((select count(*) = 0 from public.request_items where id = current_setting('test.a_lock')::uuid)
  and (select count(*) = 0 from public.request_item_files where request_item_id = current_setting('test.a_lock')::uuid)
  and (select count(*) = 0 from public.comments where request_item_id = current_setting('test.a_lock')::uuid)
  and (select count(*) = 0 from public.status_history where entity_id = current_setting('test.a_lock')::uuid),
  'a team member who is not assigned sees nothing of the locked request (item, files, comments, history)');
select pg_temp.assert((select count(*) = 0 from public.notifications where request_item_id = current_setting('test.a_lock')::uuid),
  'and gets no notifications about it');
select pg_temp.expect_error($$select public.review_item(current_setting('test.a_lock')::uuid, 'start_review')$$,
  'not permitted', 'a team member who is not assigned cannot review the locked request');
select pg_temp.act_as('manager@kp.test');
select pg_temp.assert((select count(*) = 1 from public.request_items where id = current_setting('test.a_lock')::uuid),
  'managers see locked requests');
select pg_temp.act_as('partner@kp.test');
select pg_temp.assert((select count(*) = 1 from public.request_items where id = current_setting('test.a_lock')::uuid),
  'partners see locked requests');
select pg_temp.act_as('super@kp.test');
select pg_temp.assert((select count(*) = 1 from public.request_items where id = current_setting('test.a_lock')::uuid),
  'Super admin sees locked requests');
select pg_temp.as_super();
update public.app_settings set value = jsonb_set(value, '{admin,view_all_engagements}', 'true') where key = 'role_permissions';
select pg_temp.act_as('admin@kp.test');
select pg_temp.assert((select count(*) = 0 from public.request_items where id = current_setting('test.a_lock')::uuid)
  and (select count(*) = 1 from public.request_items where id = current_setting('test.a_open')::uuid),
  'view-all does not reveal locked requests');
select pg_temp.as_super();
update public.app_settings set value = jsonb_set(value, '{admin,view_all_engagements}', 'false') where key = 'role_permissions';

-- reassignment rules
select pg_temp.act_as('member@kp.test');
select pg_temp.expect_error($$select public.set_request_item_assignees(current_setting('test.a_lock')::uuid, 'firm',
  array[(select id from public.profiles where email = 'junior@kp.test')])$$, 'not permitted',
  'on a locked request a firm assignee cannot change the assignees');
select pg_temp.expect_error($$select public.set_request_item_lock(current_setting('test.a_lock')::uuid, false)$$, 'only a partner',
  'a team member (not the creator) cannot unlock');
select pg_temp.act_as('cfo@client.test');
select pg_temp.expect_error($$select public.set_request_item_assignees(current_setting('test.a_lock')::uuid, 'client',
  array[pg_temp.uid('fc@client.test')])$$, 'not permitted',
  'on a locked request the client assignee cannot reassign');
select pg_temp.expect_error($$update public.request_items set is_locked = false where id = current_setting('test.a_lock')::uuid$$,
  'permission denied', 'nobody can unlock by a direct update');
select pg_temp.expect_error($$insert into public.request_item_assignees (request_item_id, engagement_id, user_id, side)
  values (current_setting('test.a_lock')::uuid, current_setting('test.a_eng')::uuid, auth.uid(), 'client')$$,
  'permission denied', 'assignees cannot be inserted directly');

select pg_temp.act_as('junior@kp.test');
select pg_temp.assert(public.set_request_item_assignees(current_setting('test.a_open')::uuid, 'firm',
  array[(select id from public.profiles where email = 'junior@kp.test'), (select id from public.profiles where email = 'manager@kp.test')]) = 2,
  'on an unlocked request any team member can assign firm people');
select pg_temp.expect_error($$select public.set_request_item_assignees(current_setting('test.a_open')::uuid, 'client',
  array[(select id from public.profiles where email = 'cfo@client.test')])$$, 'not permitted',
  'a team member without edit rights cannot assign client people');
select pg_temp.expect_error($$select public.set_request_item_assignees(current_setting('test.a_open')::uuid, 'firm',
  array[(select id from public.profiles where email = 'outsider@kp.test')])$$, 'members of the engagement team',
  'only team members can be assigned on the firm side');
select pg_temp.act_as('cfo@client.test');
select pg_temp.assert(public.set_request_item_assignees(current_setting('test.a_open')::uuid, 'client',
  array[pg_temp.uid('fc@client.test')]) = 1,
  'on an unlocked request a client user can assign client colleagues');
select pg_temp.expect_error($$select public.set_request_item_assignees(current_setting('test.a_open')::uuid, 'firm', '{}'::uuid[])$$,
  'not permitted', 'a client user cannot change firm-side assignees');
select pg_temp.expect_error($$select public.set_request_item_assignees(current_setting('test.a_open')::uuid, 'client',
  array[pg_temp.uid('evil@other.test')])$$, 'client users with access',
  'only client users with access can be assigned on the client side');
select pg_temp.act_as('fc@client.test');
select pg_temp.assert((select count(*) = 1 from public.notifications where type = 'item_assigned' and request_item_id = current_setting('test.a_open')::uuid),
  'new client assignee notified');
select pg_temp.assert((select count(*) = 1 from public.request_item_assignees where user_id = auth.uid()), '"Assigned to me" lists it');

-- the lead locks it with no client assignee: invisible to every client user
select pg_temp.act_as('manager@kp.test');
select public.set_request_item_assignees(current_setting('test.a_open')::uuid, 'client', '{}'::uuid[]);
select public.set_request_item_lock(current_setting('test.a_open')::uuid, true);
select pg_temp.act_as('fc@client.test');
select pg_temp.assert((select count(*) = 0 from public.request_items where id = current_setting('test.a_open')::uuid)
  and (select count(*) = 0 from public.notifications where request_item_id = current_setting('test.a_open')::uuid),
  'a locked request with no client assignee is invisible to client users (and so are notifications about it)');
select pg_temp.act_as('cfo@client.test');
select pg_temp.assert((select count(*) = 0 from public.request_items where id = current_setting('test.a_open')::uuid),
  'invisible to the other client user as well');
select pg_temp.act_as('junior@kp.test');
select pg_temp.assert((select count(*) = 1 from public.request_items where id = current_setting('test.a_open')::uuid),
  'its firm assignee still sees it');
select pg_temp.act_as('member@kp.test');
select pg_temp.assert((select count(*) = 0 from public.request_items where id = current_setting('test.a_open')::uuid),
  'a team member who is not assigned no longer sees it once locked');
select pg_temp.act_as('lead@kp.test');
select public.set_request_item_lock(current_setting('test.a_open')::uuid, false);
select pg_temp.act_as('cfo@client.test');
select pg_temp.assert((select count(*) = 1 from public.request_items where id = current_setting('test.a_open')::uuid), 'unlocked again: visible to all client users');

-- stages ---------------------------------------------------------------------------
select pg_temp.act_as('junior@kp.test');
select pg_temp.expect_error($$select public.transition_engagement(current_setting('test.a_eng')::uuid, 'in_progress')$$,
  'only a partner', 'a team member cannot move to Execution');
select pg_temp.act_as('manager@kp.test');
select pg_temp.expect_error($$select public.transition_engagement(current_setting('test.a_eng')::uuid, 'in_progress')$$,
  'critical item', 'Execution blocked while a critical item is outstanding');
select pg_temp.as_super();
select set_config('app.workflow', 'on', false);
update public.request_items set status = 'accepted' where engagement_id = current_setting('test.a_eng')::uuid and code = 'GEN-01';
select set_config('app.workflow', '', false);
select pg_temp.act_as('manager@kp.test');
select public.transition_engagement(current_setting('test.a_eng')::uuid, 'in_progress');
select pg_temp.assert((select status = 'in_progress' from public.engagements where id = current_setting('test.a_eng')::uuid),
  'critical items accepted or waived: manager moved to Execution');
select pg_temp.expect_error($$select public.transition_engagement(current_setting('test.a_eng')::uuid, 'completed')$$,
  'only a partner or the team lead', 'a manager cannot complete while items are open');
select pg_temp.act_as('lead@kp.test');
select pg_temp.expect_error($$select public.transition_engagement(current_setting('test.a_eng')::uuid, 'completed', '  ')$$,
  'reason is required', 'completing with open items needs a reason');
select pg_temp.act_as('partner@kp.test');
select public.transition_engagement(current_setting('test.a_eng')::uuid, 'completed', 'Scope reduced; remaining items not needed');
select pg_temp.assert((select status = 'completed' and completed_at is not null from public.engagements where id = current_setting('test.a_eng')::uuid)
  and (select note like 'Completed with % open item(s). Reason: Scope reduced%' from public.status_history
       where entity_type = 'engagement' and entity_id = current_setting('test.a_eng')::uuid and to_status = 'completed'),
  'partner completed with a recorded reason');
select pg_temp.as_super();
select pg_temp.assert((select count(*) = 1 from public.audit_log where entity_type = 'engagement' and action = 'engagement.status_changed'
  and entity_id = current_setting('test.a_eng') and after ->> 'status' = 'completed'), 'forced completion audited');
select pg_temp.act_as('partner@kp.test');
select public.transition_engagement(current_setting('test.a_eng')::uuid, 'in_progress');
select pg_temp.assert((select status = 'in_progress' from public.engagements where id = current_setting('test.a_eng')::uuid), 'partner reopened the engagement');
select pg_temp.as_super();
select set_config('app.workflow', 'on', false);
update public.request_items set status = 'not_applicable' where engagement_id = current_setting('test.a_eng')::uuid and not is_critical;
update public.request_items set status = 'accepted' where engagement_id = current_setting('test.a_eng')::uuid and is_critical and not is_waived;
select set_config('app.workflow', '', false);
select pg_temp.act_as('manager@kp.test');
select public.transition_engagement(current_setting('test.a_eng')::uuid, 'completed');
select pg_temp.assert((select status = 'completed' from public.engagements where id = current_setting('test.a_eng')::uuid),
  'every item accepted, waived or N/A: a manager completes without a reason');
select pg_temp.act_as('lead@kp.test');
select pg_temp.expect_error($$select public.transition_engagement(current_setting('test.eng4')::uuid, 'in_progress')$$,
  'cannot move', 'a draft cannot jump to Execution');

-- stage labels
select pg_temp.assert(public.stage_label('in_progress') = 'Execution' and public.stage_label('acceptance_review') = 'Pre-execution',
  'default stage labels (legacy acceptance states shown as Pre-execution)');
select pg_temp.act_as('admin@kp.test');
update public.app_settings set value = jsonb_set(value, '{in_progress}', '"Hacked"') where key = 'stage_labels';
select pg_temp.act_as('super@kp.test');
select pg_temp.assert(public.stage_label('in_progress') = 'Execution', 'admins cannot rename stages');
update public.app_settings set value = jsonb_set(value, '{in_progress}', '"Fieldwork"') where key = 'stage_labels';
select pg_temp.assert(public.stage_label('in_progress') = 'Fieldwork', 'Super admin renames a stage');
update public.app_settings set value = public.default_stage_labels() where key = 'stage_labels';

-- engagement types and codes -------------------------------------------------------
insert into public.engagement_types (code, name, code_prefix, sort_order) values ('IA', 'Internal Audit', 'IAU', 50);
update public.app_settings set value = to_jsonb('{PREFIX}{YY}-{SEQ3}'::text) where key = 'engagement_code_format';
select pg_temp.act_as('lead@kp.test');
select set_config('test.a_code1', public.create_engagement('11111111-1111-1111-1111-111111111111',
  (select id from public.engagement_types where code = 'IA'), 'Internal audit', null, '2026-12-31', auth.uid(), '{}'::uuid[])::text, false);
select pg_temp.assert((select code = 'IAU26-001' from public.engagements where id = current_setting('test.a_code1')::uuid),
  'new type with its own prefix; code follows the configured format');
select pg_temp.as_super();
update public.app_settings set value = to_jsonb('{PREFIX}-{SEQ5}'::text) where key = 'engagement_code_format';
update public.engagement_types set is_active = false where code = 'IA';
select pg_temp.act_as('lead@kp.test');
select set_config('test.a_code2', public.create_engagement('11111111-1111-1111-1111-111111111111',
  (select id from public.engagement_types where code = 'SA'), 'No year', null, '2026-12-31', auth.uid(), '{}'::uuid[])::text, false);
select pg_temp.assert((select code = 'SA-00001' from public.engagements where id = current_setting('test.a_code2')::uuid),
  'a format without a year uses its own sequence');
select pg_temp.expect_error($$select public.create_engagement('11111111-1111-1111-1111-111111111111',
  (select id from public.engagement_types where code = 'IA'), 'Inactive', null, '2026-12-31', auth.uid(), '{}'::uuid[])$$,
  'inactive engagement type', 'deactivated types cannot be used for new engagements');
select pg_temp.as_super();
update public.app_settings set value = to_jsonb('{PREFIX}/{SEQ4}'::text) where key = 'engagement_code_format';
select pg_temp.assert(not public.valid_engagement_code_format('{PREFIX}/{SEQ4}') and not public.valid_engagement_code_format('{PREFIX}-{YYYY}')
  and public.valid_engagement_code_format('{PREFIX}-{YYYY}-{SEQ4}'), 'code formats are validated (safe characters, sequence required)');
select pg_temp.act_as('lead@kp.test');
select set_config('test.a_code3', public.create_engagement('11111111-1111-1111-1111-111111111111',
  (select id from public.engagement_types where code = 'SA'), 'Fallback', null, '2029-12-31', auth.uid(), '{}'::uuid[])::text, false);
select pg_temp.assert((select code ~ '^SA-2029-\d{4}$' from public.engagements where id = current_setting('test.a_code3')::uuid),
  'an invalid format falls back to the default');
select pg_temp.assert((select code = 'SA-2026-0001' from public.engagements where id = current_setting('test.eng')::uuid),
  'existing codes never change');
select pg_temp.as_super();
update public.app_settings set value = to_jsonb('{PREFIX}-{YYYY}-{SEQ4}'::text) where key = 'engagement_code_format';
update public.engagement_types set is_active = true where code = 'IA';

-- =============================================================================
-- 0009 (Agent B): checklist taxonomy, file classes, priority rename, uploads
-- without per-item types, notification settings, e-mail dispatch selection
-- =============================================================================
select pg_temp.as_super();

-- priority rename -------------------------------------------------------------
select pg_temp.assert((select array_agg(enumlabel::text order by enumsortorder) = array['low','normal','important','urgent']
  from pg_enum where enumtypid = 'public.item_priority'::regtype), 'priorities are Low, Normal, Important, Urgent');
select pg_temp.expect_error($$select 'high'::public.item_priority$$, 'invalid input value', 'the old priority "high" no longer exists');
select pg_temp.assert((select count(*) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosrc ~ '''high''::(public\.)?item_priority'), 'no function still casts ''high''');
select pg_temp.assert((select count(*) > 0 from public.master_checklist_items where default_priority = 'important')
  and (select count(*) > 0 from public.request_items where priority = 'important'), 'existing high values became important');

-- categories & default folders: permissions -------------------------------------
select pg_temp.act_as('admin@kp.test');   -- admin: manage_checklist on by default
insert into public.master_categories (code, name, sort_order) values ('TST', 'Test category', 500);
update public.master_categories set name = 'Test category (renamed)', sort_order = 510 where code = 'TST';
select pg_temp.assert((select name = 'Test category (renamed)' and sort_order = 510 from public.master_categories where code = 'TST'),
  'admin with manage_checklist adds, renames and reorders a category');
update public.master_categories set is_active = false where code = 'TST';
select pg_temp.assert((select not is_active from public.master_categories where code = 'TST'), 'admin deactivates a category');
select pg_temp.expect_error($$update public.master_categories set code = 'XXX' where code = 'TST'$$, 'permission denied',
  'a category code cannot be changed once created');
insert into public.master_folders (name, sort_order) values ('  19   Test   Folder ', 900);
select pg_temp.assert((select count(*) = 1 from public.master_folders where name = '19 Test Folder'), 'admin adds a default folder (name tidied)');
select pg_temp.expect_error($$insert into public.master_folders (name) values ('19 TEST FOLDER')$$, 'duplicate',
  'folder names are unique (case-insensitive)');
select pg_temp.assert((select count(*) = 18 from public.master_folders where name ~ '^(0[1-9]|1[0-8]) '), 'seeded default folders 01-18 exist');
insert into public.master_checklist_items (code, category_id, title, default_folder, default_priority, is_critical)
values ('TST-01', (select id from public.master_categories where code = 'TST'), 'Test item', '19 Test Folder', 'normal', true);
insert into public.master_checklist_items (code, category_id, title, default_folder)
values ('TST-02', (select id from public.master_categories where code = 'TST'), 'Second test item', '20 Brand New Folder');
select pg_temp.assert((select count(*) = 1 from public.master_folders where name = '20 Brand New Folder'),
  'saving a master item with a new folder name adds it to the managed list');
select public.rename_master_folder((select id from public.master_folders where name = '20 Brand New Folder'), '20 Renamed Folder');
select pg_temp.assert((select default_folder = '20 Renamed Folder' and revision = 1 from public.master_checklist_items where code = 'TST-02'),
  'renaming a folder carries to master items without a new revision');
select pg_temp.act_as('super@kp.test');
select pg_temp.assert((select count(*) >= 2 from public.audit_log where entity_type in ('master_category', 'master_folder')),
  'category and folder changes are audited');

select pg_temp.as_super();
update public.app_settings set value = jsonb_set(value, '{admin,manage_checklist}', 'false') where key = 'role_permissions';
select pg_temp.act_as('admin@kp.test');
select pg_temp.expect_error($$insert into public.master_categories (code, name) values ('TS2', 'Nope')$$, 'row-level security',
  'admin WITHOUT manage_checklist cannot add a category');
update public.master_categories set name = 'hacked' where code = 'TST';
select pg_temp.expect_error($$insert into public.master_folders (name) values ('99 Nope')$$, 'row-level security',
  'admin WITHOUT manage_checklist cannot add a folder');
select pg_temp.expect_error($$select public.rename_master_folder((select id from public.master_folders where name = '19 Test Folder'), 'x')$$,
  'not permitted', 'admin WITHOUT manage_checklist cannot rename a folder');
update public.master_checklist_items set title = 'hacked' where code = 'TST-01';
select pg_temp.as_super();
select pg_temp.assert((select name <> 'hacked' from public.master_categories where code = 'TST')
  and (select title <> 'hacked' from public.master_checklist_items where code = 'TST-01'),
  'admin WITHOUT manage_checklist cannot rename categories or edit master items');
update public.app_settings set value = jsonb_set(value, '{admin,manage_checklist}', 'true') where key = 'role_permissions';
update public.app_settings set value = jsonb_set(value, '{staff,manage_checklist}', 'true') where key = 'role_permissions';
select pg_temp.act_as('member@kp.test');
insert into public.master_folders (name) values ('21 Staff Folder');
select pg_temp.assert((select count(*) = 1 from public.master_folders where name = '21 Staff Folder'),
  'staff granted manage_checklist can add a folder');
select pg_temp.as_super();
update public.app_settings set value = jsonb_set(value, '{staff,manage_checklist}', 'false') where key = 'role_permissions';
select pg_temp.act_as('member@kp.test');
select pg_temp.expect_error($$insert into public.master_categories (code, name) values ('TS3', 'Nope')$$, 'row-level security',
  'staff without manage_checklist cannot add a category');
select pg_temp.act_as('cfo@client.test');
select pg_temp.assert((select count(*) = 0 from public.master_folders), 'clients cannot read the default folders');

-- settings are Super admin only
select pg_temp.act_as('admin@kp.test');
update public.app_settings set value = '1' where key = 'uploads.max_file_mb';
select pg_temp.expect_error($$insert into public.app_settings (key, value) values ('x.test', '1')$$, 'row-level security',
  'admins cannot add settings');
select pg_temp.act_as('super@kp.test');
select pg_temp.assert((select value = '100'::jsonb from public.app_settings where key = 'uploads.max_file_mb'), 'admins cannot change settings');
update public.app_settings set value = '100' where key = 'uploads.max_file_mb';

-- file classes --------------------------------------------------------------------
select pg_temp.assert((select file_class = 'permanent' from public.master_checklist_items where code = 'GEN-01')
  and (select file_class = 'current' from public.master_checklist_items where code = 'FST-01')
  and (select count(*) = 0 from public.master_checklist_items where file_class is null and code !~ '^TST'),
  'seeded file classes: CAC certificate permanent, trial balance current, none missing');
select pg_temp.assert((select file_class = 'permanent' from public.request_items where engagement_id = current_setting('test.eng')::uuid and code = 'GEN-01')
  and (select file_class = 'current' from public.request_items where engagement_id = current_setting('test.eng')::uuid and code = 'CSH-01'),
  'file class copied into engagement items on creation');
select pg_temp.act_as('lead@kp.test');
select pg_temp.assert(public.add_master_items_to_engagement(current_setting('test.eng4')::uuid,
  array(select id from public.master_checklist_items where code in ('JNL-01', 'ITE-01', 'TST-01'))) = 3, 'master items added to an engagement');
select pg_temp.assert((select file_class = 'current' from public.request_items where engagement_id = current_setting('test.eng4')::uuid and code = 'JNL-01')
  and (select file_class = 'permanent' from public.request_items where engagement_id = current_setting('test.eng4')::uuid and code = 'ITE-01'),
  'file class copied by add_master_items_to_engagement');
select pg_temp.assert((select count(*) = 1 from public.engagement_folders where engagement_id = current_setting('test.eng4')::uuid and name = '15 Journals'),
  'new default folder created on the engagement');
select pg_temp.assert((select priority = 'normal' from public.request_items where engagement_id = current_setting('test.eng4')::uuid and code = 'TST-01'),
  'add_master_items keeps the master priority');
select set_config('test.eng5', public.create_engagement(
  '11111111-1111-1111-1111-111111111111', (select id from public.engagement_types where code = 'SA'),
  'Priority check', null, '2028-12-31', (select id from public.profiles where email = 'lead@kp.test'),
  array(select id from public.master_checklist_items where code = 'TST-01'))::text, false);
select pg_temp.assert((select priority = 'important' from public.request_items where engagement_id = current_setting('test.eng5')::uuid and code = 'TST-01'),
  'create_engagement raises critical normal-priority items to Important');
update public.request_items set file_class = 'permanent' where engagement_id = current_setting('test.eng4')::uuid and code = 'JNL-01';
select pg_temp.assert((select file_class = 'permanent' from public.request_items where engagement_id = current_setting('test.eng4')::uuid and code = 'JNL-01'),
  'the team can change an item''s file class');
select pg_temp.act_as('admin@kp.test');
update public.master_checklist_items set file_class = 'current' where code = 'ITE-01';
select pg_temp.assert((select revision = 2 from public.master_checklist_items where code = 'ITE-01'), 'changing the file class bumps the master revision');
select pg_temp.act_as('lead@kp.test');
select public.pull_master_changes(current_setting('test.eng4')::uuid);
select pg_temp.assert((select file_class = 'current' from public.request_items where engagement_id = current_setting('test.eng4')::uuid and code = 'ITE-01'),
  'pulling master changes refreshes the file class');

-- no per-item file type enforcement ---------------------------------------------------
select pg_temp.as_super();
update public.request_items set expected_file_types = '{pdf}' where engagement_id = current_setting('test.eng')::uuid and code = 'FST-01';
select pg_temp.act_as('cfo@client.test');
select set_config('test.tb', (select file_id::text from public.begin_upload(
  (select id from public.request_items where engagement_id = current_setting('test.eng')::uuid and code = 'FST-01'),
  'Trial balance.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 4096)), false);
select pg_temp.assert(current_setting('test.tb') <> '', 'an .xlsx is accepted on an item whose legacy expected types say pdf');
select pg_temp.expect_error($$select * from public.begin_upload((select id from public.request_items where engagement_id = current_setting('test.eng')::uuid and code = 'FST-01'), 'x.exe', 'application/octet-stream', 10)$$,
  'not allowed', 'the firm-wide allowed types still apply');
select pg_temp.as_super();
select public.complete_upload(current_setting('test.tb')::uuid, (select id from auth.users where email = 'cfo@client.test'));
select pg_temp.act_as('cfo@client.test');
select public.submit_item((select id from public.request_items where engagement_id = current_setting('test.eng')::uuid and code = 'FST-01'));

-- notification settings ------------------------------------------------------------------
select pg_temp.as_super();
select pg_temp.assert((select count(*) = 0 from public.engagements e
  where not exists (select 1 from public.engagement_notification_settings s where s.engagement_id = e.id)),
  'every engagement has notification settings');
select pg_temp.assert((select client_instant and client_reminder_frequency = 'weekly' and client_reminder_time = '17:00'
  and team_reminder_frequency = 'weekdays' from public.engagement_notification_settings where engagement_id = current_setting('test.eng')::uuid),
  'settings start from the firm-wide defaults');
update public.app_settings set value = value || '{"client_reminder_time": "18:00", "team_instant": false}' where key = 'notifications.defaults';
select pg_temp.act_as('lead@kp.test');
select set_config('test.eng6', public.create_engagement(
  '11111111-1111-1111-1111-111111111111', (select id from public.engagement_types where code = 'AD'),
  'Defaults check', null, '2028-12-31', (select id from public.profiles where email = 'lead@kp.test'), '{}'::uuid[])::text, false);
select pg_temp.assert((select client_reminder_time = '18:00' and not team_instant from public.engagement_notification_settings
  where engagement_id = current_setting('test.eng6')::uuid), 'new engagements copy the changed firm-wide defaults');
select pg_temp.as_super();
update public.app_settings set value = '{"client_reminder_time": "not a time"}' where key = 'notifications.defaults';
select pg_temp.act_as('lead@kp.test');
select set_config('test.eng7', public.create_engagement(
  '11111111-1111-1111-1111-111111111111', (select id from public.engagement_types where code = 'AD'),
  'Bad defaults', null, '2028-12-31', (select id from public.profiles where email = 'lead@kp.test'), '{}'::uuid[])::text, false);
select pg_temp.assert((select client_reminder_time = '17:00' from public.engagement_notification_settings
  where engagement_id = current_setting('test.eng7')::uuid), 'malformed defaults never block engagement creation');
select pg_temp.as_super();
update public.app_settings set value = '{"client_instant": true, "client_reminder_frequency": "weekly", "client_reminder_weekday": 1,
  "client_reminder_time": "17:00", "client_only_when_outstanding": true, "team_instant": true,
  "team_reminder_frequency": "weekdays", "team_reminder_weekday": 1, "team_reminder_time": "09:00"}' where key = 'notifications.defaults';

select pg_temp.act_as('member@kp.test');
select pg_temp.assert((select count(*) = 1 from public.engagement_notification_settings where engagement_id = current_setting('test.eng')::uuid),
  'team members can read the engagement''s notification settings');
update public.engagement_notification_settings set client_instant = false where engagement_id = current_setting('test.eng')::uuid;
select pg_temp.act_as('manager@kp.test');
select pg_temp.assert((select client_instant from public.engagement_notification_settings where engagement_id = current_setting('test.eng')::uuid),
  'a team member (not lead/manager) cannot change notification settings');
update public.engagement_notification_settings set client_reminder_frequency = 'daily', client_reminder_time = '09:00',
  team_reminder_frequency = 'daily', team_reminder_time = '08:00'
where engagement_id = current_setting('test.eng')::uuid;
select pg_temp.assert((select client_reminder_frequency = 'daily' and updated_by = auth.uid() from public.engagement_notification_settings
  where engagement_id = current_setting('test.eng')::uuid), 'a manager changes notification settings (stamped)');
select pg_temp.act_as('cfo@client.test');
select pg_temp.assert((select count(*) = 0 from public.engagement_notification_settings), 'clients cannot read the team''s notification settings');
update public.engagement_notification_settings set client_instant = false;
select pg_temp.act_as('outsider@kp.test');
select pg_temp.assert((select count(*) = 0 from public.engagement_notification_settings), 'staff outside the team cannot read notification settings');
select pg_temp.expect_error($$select * from public.email_dispatch_queue()$$, 'permission denied', 'only the server (service role) can read the e-mail queue');
select pg_temp.expect_error($$select * from public.reminder_digests_due()$$, 'permission denied', 'only the server (service role) can select reminders');
select pg_temp.as_super();
select pg_temp.assert((select client_instant from public.engagement_notification_settings where engagement_id = current_setting('test.eng')::uuid),
  'client update had no effect');

-- instant e-mail queue ---------------------------------------------------------------------
select pg_temp.assert((select count(*) > 0 from public.email_dispatch_queue(2000) where deliver), 'new notifications are queued for e-mail');
select public.mark_notifications_emailed(array(select notification_id from public.email_dispatch_queue(2000)));
select pg_temp.assert((select count(*) = 0 from public.email_dispatch_queue(2000)), 'e-mailed notifications leave the queue');
insert into public.notifications (user_id, type, title, engagement_id, request_item_id) values
  ((select id from public.profiles where email = 'cfo@client.test'), 'item_queried', 'Q1', current_setting('test.eng')::uuid,
   (select id from public.request_items where engagement_id = current_setting('test.eng')::uuid and code = 'REC-01')),
  ((select id from public.profiles where email = 'cfo@client.test'), 'item_queried', 'Q-locked', current_setting('test.eng')::uuid,
   (select id from public.request_items where engagement_id = current_setting('test.eng')::uuid and code = 'REC-02')),
  ((select id from public.profiles where email = 'lead@kp.test'), 'item_submitted', 'S1', current_setting('test.eng')::uuid, null),
  ((select id from public.profiles where email = 'outsider@kp.test'), 'comment', 'Not on team', current_setting('test.eng')::uuid, null);
insert into public.notifications (user_id, type, title, engagement_id, created_at) values
  ((select id from public.profiles where email = 'lead@kp.test'), 'comment', 'Old', current_setting('test.eng')::uuid, now() - interval '3 days');
update public.request_items set is_locked = true where engagement_id = current_setting('test.eng')::uuid and code = 'REC-02';
select pg_temp.assert((select deliver from public.email_dispatch_queue() where title = 'Q1')
  and (select deliver from public.email_dispatch_queue() where title = 'S1'), 'client and team notifications are delivered');
select pg_temp.assert((select not deliver and skip_reason like '%not visible%' from public.email_dispatch_queue() where title = 'Q-locked'),
  'a notification about a locked item the client cannot see is never e-mailed');
select pg_temp.assert((select not deliver and skip_reason like '%team%' from public.email_dispatch_queue() where title = 'Not on team'),
  'staff no longer on the team are not e-mailed');
select pg_temp.assert((select not deliver and skip_reason like '%older%' from public.email_dispatch_queue() where title = 'Old'),
  'old notifications are not e-mailed');
update public.engagement_notification_settings set client_instant = false where engagement_id = current_setting('test.eng')::uuid;
select pg_temp.assert((select not deliver and skip_reason like '%off for the client%' from public.email_dispatch_queue() where title = 'Q1')
  and (select deliver from public.email_dispatch_queue() where title = 'S1'), 'client instant e-mails off: client skipped, team still e-mailed');
update public.engagement_notification_settings set client_instant = true where engagement_id = current_setting('test.eng')::uuid;
update public.profiles set is_active = false where email = 'cfo@client.test';
select pg_temp.assert((select not deliver and skip_reason = 'recipient deactivated' from public.email_dispatch_queue() where title = 'Q1'),
  'deactivated users are not e-mailed');
update public.profiles set is_active = true where email = 'cfo@client.test';
select public.mark_notifications_emailed(array(select notification_id from public.email_dispatch_queue() where title = 'S1'), 'SMTP timeout');
select pg_temp.assert((select email_attempts = 1 and emailed_at is null and email_error = 'SMTP timeout' from public.notifications where title = 'S1'),
  'a failed send is recorded and retried');
update public.notifications set email_attempts = 4 where title = 'S1';
select public.mark_notifications_emailed(array(select id from public.notifications where title = 'S1'), 'SMTP timeout');
select pg_temp.assert((select emailed_at is not null and email_skipped like 'failed after%' from public.notifications where title = 'S1'),
  'a send that keeps failing is given up after 5 attempts');
select public.mark_notifications_emailed(array(select notification_id from public.email_dispatch_queue(2000)));

-- reminder digests (2026-10-26 is a Monday; times are Lagos = UTC+1) ------------------------
select set_config('test.mon10', '2026-10-26 09:30:00+00', false);  -- 10:30 Lagos
select pg_temp.assert(public.reminder_is_due('weekly', 1::smallint, '17:00', 1, '17:05')
  and not public.reminder_is_due('weekly', 1::smallint, '17:00', 2, '17:05')
  and not public.reminder_is_due('weekly', 1::smallint, '17:00', 1, '16:59')
  and public.reminder_is_due('weekdays', 1::smallint, '09:00', 5, '09:00')
  and not public.reminder_is_due('weekdays', 1::smallint, '09:00', 6, '10:00')
  and not public.reminder_is_due('off', 1::smallint, '00:00', 1, '23:00'), 'reminder schedule rules (weekly / weekdays / off / time of day)');
select set_config('test.cfo_n', (select count(*)::text from public.request_items ri
  where ri.engagement_id = current_setting('test.eng')::uuid and ri.status in ('requested', 'queried') and not ri.is_locked), false);
select pg_temp.assert((select item_count = current_setting('test.cfo_n')::int and jsonb_array_length(items) = item_count
  from public.reminder_digests_due(current_setting('test.mon10')::timestamptz)
  where engagement_id = current_setting('test.eng')::uuid and audience = 'client' and email = 'cfo@client.test'),
  'client digest lists the outstanding items the client can see');
select pg_temp.assert((select not (items @> jsonb_build_array(jsonb_build_object('code', 'REC-02')))
  from public.reminder_digests_due(current_setting('test.mon10')::timestamptz)
  where engagement_id = current_setting('test.eng')::uuid and audience = 'client' and email = 'cfo@client.test'),
  'client digest never includes a locked item the client cannot see');
select pg_temp.assert((select bool_and(item_count = 1 and items -> 0 ->> 'code' = 'FST-01') and count(*) = 3
  from public.reminder_digests_due(current_setting('test.mon10')::timestamptz)
  where engagement_id = current_setting('test.eng')::uuid and audience = 'team'),
  'team digest: each team member gets the client submission awaiting review');
select pg_temp.assert((select count(*) = 0 from public.reminder_digests_due('2026-10-26 06:30:00+00')
  where engagement_id = current_setting('test.eng')::uuid), 'nothing is due before the configured time');
select pg_temp.assert((select count(*) = 0 from public.reminder_digests_due(current_setting('test.mon10')::timestamptz)
  where engagement_id in (current_setting('test.eng3')::uuid, current_setting('test.eng4')::uuid)),
  'unreleased engagements get no reminders');
select pg_temp.assert((select count(*) = 0 from public.reminder_digests_due(current_setting('test.mon10')::timestamptz)
  where engagement_id = current_setting('test.eng2')::uuid and audience = 'client'),
  'weekly client reminders are not sent before their time (17:00)');
select public.record_reminder(current_setting('test.eng')::uuid, (select id from public.profiles where email = 'cfo@client.test'),
  'client', '2026-10-26', 5, 'sent');
select pg_temp.assert((select count(*) = 0 from public.reminder_digests_due(current_setting('test.mon10')::timestamptz)
  where engagement_id = current_setting('test.eng')::uuid and audience = 'client'), 'a reminder is sent at most once per day');
select pg_temp.assert((select count(*) = 1 from public.reminder_digests_due('2026-10-27 09:30:00+00')
  where engagement_id = current_setting('test.eng')::uuid and audience = 'client'), 'the daily reminder is due again the next day');
update public.engagement_client_access set revoked_at = now()
where engagement_id = current_setting('test.eng')::uuid and contact_id = (select id from public.client_contacts where email = 'cfo@client.test');
select pg_temp.assert((select count(*) = 0 from public.reminder_digests_due('2026-10-27 09:30:00+00')
  where engagement_id = current_setting('test.eng')::uuid and audience = 'client'), 'revoked client users get no reminders');
update public.engagement_client_access set revoked_at = null
where engagement_id = current_setting('test.eng')::uuid and contact_id = (select id from public.client_contacts where email = 'cfo@client.test');
update public.engagement_notification_settings set client_only_when_outstanding = false, client_reminder_frequency = 'daily', client_reminder_time = '09:00'
where engagement_id = current_setting('test.eng2')::uuid;
select pg_temp.assert((select count(*) = 1 from public.reminder_digests_due(current_setting('test.mon10')::timestamptz)
  where engagement_id = current_setting('test.eng2')::uuid and audience = 'client'), 'client reminder due on the second engagement');
select pg_temp.as_super();
select set_config('app.workflow', 'on', false);
update public.request_items set status = 'accepted' where engagement_id = current_setting('test.eng2')::uuid;
select set_config('app.workflow', '', false);
select pg_temp.assert((select item_count = 0 from public.reminder_digests_due(current_setting('test.mon10')::timestamptz)
  where engagement_id = current_setting('test.eng2')::uuid and audience = 'client'),
  '"only when outstanding" off: the client still gets a (nothing outstanding) reminder');
update public.engagement_notification_settings set client_only_when_outstanding = true where engagement_id = current_setting('test.eng2')::uuid;
select pg_temp.assert((select count(*) = 0 from public.reminder_digests_due(current_setting('test.mon10')::timestamptz)
  where engagement_id = current_setting('test.eng2')::uuid), '"only when outstanding" on: no reminder when nothing is outstanding; team skipped without submissions');
