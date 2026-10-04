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
update public.request_items set due_date = '2026-10-15', assignee_id = (select id from public.profiles where email = 'member@kp.test')
where engagement_id = current_setting('test.eng')::uuid and code = 'GEN-01';
select pg_temp.assert((select due_date = '2026-10-15' from public.request_items where code = 'GEN-01'), 'lead can set due date/assignee');

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

-- acceptance gate ----------------------------------------------------------------------------------------------------
select public.transition_engagement(current_setting('test.eng')::uuid, 'acceptance_review');
select pg_temp.expect_error($$select public.record_acceptance_decision(current_setting('test.eng')::uuid, 'go', 'All good')$$,
  'outstanding', 'GO blocked while critical items are outstanding');
select pg_temp.expect_error($$select public.transition_engagement(current_setting('test.eng')::uuid, 'in_progress')$$,
  'cannot move', 'cannot jump to in_progress from acceptance_review');

-- satisfy remaining critical items (superuser shortcut for the test)
select pg_temp.as_super();
select set_config('app.workflow', 'on', false);
update public.request_items set status = 'accepted'
where engagement_id = current_setting('test.eng')::uuid and is_critical and not is_waived and status <> 'accepted';
select set_config('app.workflow', '', false);

select pg_temp.act_as('lead@kp.test');
select pg_temp.expect_error($$select public.record_acceptance_decision(current_setting('test.eng')::uuid, 'go', '')$$,
  'note is required', 'decision note mandatory');
select public.record_acceptance_decision(current_setting('test.eng')::uuid, 'go', 'Independence confirmed; KYC complete.');
select pg_temp.assert((select status = 'accepted' from public.engagements where id = current_setting('test.eng')::uuid), 'GO -> accepted');
select public.transition_engagement(current_setting('test.eng')::uuid, 'in_progress');
select pg_temp.assert((select status = 'in_progress' and fieldwork_started_at is not null from public.engagements
  where id = current_setting('test.eng')::uuid), 'fieldwork started after gate');

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

-- audit
select pg_temp.act_as('admin@kp.test');
select pg_temp.assert((select count(*) > 0 from public.audit_log where action = 'request_item.status_changed'), 'status changes audited');
select pg_temp.assert((select count(*) > 0 from public.audit_log where action = 'request_item.waived'), 'waiver audited');
select pg_temp.assert((select count(*) > 0 from public.audit_log where action = 'file.submitted'), 'file submission audited');
select pg_temp.assert((select count(*) = 1 from public.audit_log where action = 'acceptance_decision.insert'), 'decision audited');
select pg_temp.as_super();
select pg_temp.expect_error($$delete from public.audit_log$$, 'append-only', 'audit log is append-only');
select pg_temp.assert((select count(*) >= 4 from public.status_history
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
select pg_temp.act_as('admin@kp.test');
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
