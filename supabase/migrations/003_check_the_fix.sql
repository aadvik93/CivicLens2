-- CivicLens "Check the Fix" evidence review and recurrence workflow.
-- Apply only after 001 and 002 on a backed-up staging project.
-- No report, photo, evidence, assessment, response, or audit row is deleted.

-- Preserve legacy status values while adding the explicit Check the Fix lifecycle.
alter table public.reports alter column internal_status set default 'reported';
alter table public.reports drop constraint if exists reports_internal_status_check;
alter table public.reports add constraint reports_internal_status_check check (
  internal_status in (
    'new', 'in_review', 'needs_information', 'closed_internal',
    'reported', 'under_review', 'action_reported', 'resolution_verified',
    'needs_more_evidence', 'reopened'
  )
);
alter table public.report_history add column if not exists actor_role text check (actor_role is null or actor_role in ('resident','reviewer','system'));
alter table public.report_history drop constraint if exists report_history_internal_status_old_check;
alter table public.report_history add constraint report_history_internal_status_old_check check (
  internal_status_old is null or internal_status_old in (
    'new', 'in_review', 'needs_information', 'closed_internal',
    'reported', 'under_review', 'action_reported', 'resolution_verified',
    'needs_more_evidence', 'reopened'
  )
);
alter table public.report_history drop constraint if exists report_history_internal_status_new_check;
alter table public.report_history add constraint report_history_internal_status_new_check check (
  internal_status_new is null or internal_status_new in (
    'new', 'in_review', 'needs_information', 'closed_internal',
    'reported', 'under_review', 'action_reported', 'resolution_verified',
    'needs_more_evidence', 'reopened'
  )
);

create table if not exists public.report_evidence (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id),
  actor_id uuid not null references auth.users(id),
  evidence_kind text not null check (evidence_kind = 'after'),
  object_path text not null unique,
  action_note text not null check (char_length(btrim(action_note)) between 1 and 1200),
  uploaded_at timestamptz not null default now(),
  captured_at timestamptz,
  content_type text not null check (content_type in ('image/jpeg','image/png','image/webp')),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 5242880)
);
create index if not exists report_evidence_latest_idx on public.report_evidence(report_id, uploaded_at desc);

create table if not exists public.check_fix_assessments (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id),
  evidence_id uuid not null references public.report_evidence(id),
  before_object_path text not null,
  comparable boolean not null,
  outcome text not null check (outcome in ('possible_improvement','problem_may_remain','cannot_assess')),
  rationale text not null check (char_length(btrim(rationale)) between 1 and 1600),
  provider text,
  model text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists check_fix_assessments_version_idx on public.check_fix_assessments(report_id, evidence_id, created_at desc);

create table if not exists public.check_fix_responses (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id),
  actor_id uuid not null references auth.users(id),
  response text not null check (response in ('confirm_improvement','dispute')),
  note text not null default '' check (char_length(note) <= 1200),
  created_at timestamptz not null default now()
);
create index if not exists check_fix_responses_report_idx on public.check_fix_responses(report_id, created_at desc);

create table if not exists public.garbage_recurrence_links (
  id uuid primary key default gen_random_uuid(),
  new_report_id uuid not null references public.reports(id),
  prior_report_id uuid not null references public.reports(id),
  decision text not null check (decision in ('confirmed','rejected')),
  decision_note text not null default '' check (char_length(decision_note) <= 1000),
  actor_id uuid not null references auth.users(id),
  decided_at timestamptz not null default now(),
  check (new_report_id <> prior_report_id),
  unique (new_report_id, prior_report_id)
);
create index if not exists garbage_recurrence_prior_idx on public.garbage_recurrence_links(prior_report_id, decided_at desc);

create table if not exists public.garbage_recurrence_decisions (
  id uuid primary key default gen_random_uuid(),
  new_report_id uuid not null references public.reports(id),
  prior_report_id uuid not null references public.reports(id),
  decision text not null check (decision in ('confirmed','rejected')),
  decision_note text not null default '' check (char_length(decision_note) <= 1000),
  actor_id uuid not null references auth.users(id),
  decided_at timestamptz not null default now(),
  check (new_report_id <> prior_report_id)
);
create index if not exists garbage_recurrence_decisions_pair_idx on public.garbage_recurrence_decisions(new_report_id,prior_report_id,decided_at desc);

alter table public.report_evidence enable row level security;
alter table public.check_fix_assessments enable row level security;
alter table public.check_fix_responses enable row level security;
alter table public.garbage_recurrence_links enable row level security;
alter table public.garbage_recurrence_decisions enable row level security;

revoke all on public.report_evidence from anon, authenticated;
revoke all on public.check_fix_assessments from anon, authenticated;
revoke all on public.check_fix_responses from anon, authenticated;
revoke all on public.garbage_recurrence_links from anon, authenticated;
revoke all on public.garbage_recurrence_decisions from anon, authenticated;
grant select on public.report_evidence, public.check_fix_assessments, public.check_fix_responses, public.garbage_recurrence_links, public.garbage_recurrence_decisions to authenticated;

create policy "report owners and reviewers read evidence"
on public.report_evidence for select to authenticated
using (exists (
  select 1 from public.reports r where r.id = report_evidence.report_id
  and (r.reporter_id = (select auth.uid()) or public.get_my_role() = 'reviewer'::public.app_role)
));
create policy "report owners and reviewers read check fix assessments"
on public.check_fix_assessments for select to authenticated
using (exists (
  select 1 from public.reports r where r.id = check_fix_assessments.report_id
  and (r.reporter_id = (select auth.uid()) or public.get_my_role() = 'reviewer'::public.app_role)
));
create policy "report owners and reviewers read check fix responses"
on public.check_fix_responses for select to authenticated
using (exists (
  select 1 from public.reports r where r.id = check_fix_responses.report_id
  and (r.reporter_id = (select auth.uid()) or public.get_my_role() = 'reviewer'::public.app_role)
));
create policy "owners and reviewers read recurrence decisions"
on public.garbage_recurrence_links for select to authenticated
using (
  public.get_my_role() = 'reviewer'::public.app_role
  or exists (select 1 from public.reports r where r.id = garbage_recurrence_links.new_report_id and r.reporter_id = (select auth.uid()))
);

create policy "owners and reviewers read recurrence decision history"
on public.garbage_recurrence_decisions for select to authenticated
using (
  public.get_my_role() = 'reviewer'::public.app_role
  or exists (select 1 from public.reports r where r.id = garbage_recurrence_decisions.new_report_id and r.reporter_id = (select auth.uid()))
);


-- New reports use the explicit lifecycle. The idempotency key still prevents duplicate rows.
create or replace function public.create_civic_report(
  p_id uuid, p_idempotency_key uuid, p_category public.issue_category,
  p_description text, p_complaint_text text, p_complaint_language text,
  p_location_label text, p_latitude double precision, p_longitude double precision,
  p_location_accuracy_m double precision, p_photo_object_path text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_report_id uuid;
begin
  if v_uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_category is null then raise exception 'Category is required'; end if;
  if p_description is null or char_length(btrim(p_description)) not between 1 and 1200 then raise exception 'Description must contain 1 to 1200 characters'; end if;
  if p_complaint_language not in ('English','Hindi') then raise exception 'Unsupported complaint language'; end if;
  if p_latitude is null or p_latitude < -90 or p_latitude > 90 or p_longitude is null or p_longitude < -180 or p_longitude > 180 then raise exception 'Valid coordinates are required'; end if;
  if p_id is null or p_idempotency_key is null then raise exception 'Report and idempotency IDs are required'; end if;
  if p_photo_object_path is null or split_part(p_photo_object_path, '/', 1) <> v_uid::text then raise exception 'Photo path must belong to the signed-in resident' using errcode = '42501'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'civiclens-private-photos' and o.name = p_photo_object_path) then raise exception 'Uploaded photo was not found in private storage'; end if;
  insert into public.reports (
    id, reporter_id, category, description, complaint_text, complaint_language, location_label,
    latitude, longitude, location_accuracy_m, photo_object_path, internal_status, data_class,
    idempotency_key, created_at, updated_at
  ) values (
    p_id, v_uid, p_category, btrim(p_description), coalesce(p_complaint_text,''), p_complaint_language,
    coalesce(p_location_label,''), p_latitude, p_longitude, p_location_accuracy_m, p_photo_object_path,
    case when p_category='Garbage dump'::public.issue_category then 'reported' else 'new' end, 'test', p_idempotency_key, now(), now()
  ) on conflict (reporter_id, idempotency_key) do nothing returning id into v_report_id;
  if v_report_id is null then
    select r.id into v_report_id from public.reports r where r.reporter_id = v_uid and r.idempotency_key = p_idempotency_key;
    return v_report_id;
  end if;
  insert into public.report_history (report_id, actor_id, actor_role, old_status, new_status, internal_status_old, internal_status_new, note, created_at)
  values (v_report_id, v_uid, 'resident', null, 'Report created'::public.report_status, null, case when p_category='Garbage dump'::public.issue_category then 'reported' else 'new' end, 'Report created by resident.', now());
  return v_report_id;
end; $$;
revoke all on function public.create_civic_report(uuid,uuid,public.issue_category,text,text,text,text,double precision,double precision,double precision,text) from public, anon;
grant execute on function public.create_civic_report(uuid,uuid,public.issue_category,text,text,text,text,double precision,double precision,double precision,text) to authenticated;

-- A reviewer can transition only through the explicit allowed lifecycle.
create or replace function public.transition_check_fix(p_report_id uuid, p_to_status text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_from text; v_category public.issue_category;
begin
  if v_uid is null or public.get_my_role() <> 'reviewer'::public.app_role then raise exception 'Reviewer role required' using errcode = '42501'; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 1200 then raise exception 'A reason (1–1200 characters) is required'; end if;
  select r.internal_status, r.category into v_from, v_category from public.reports r where r.id = p_report_id for update;
  if not found then raise exception 'Report not found'; end if;
  if v_category <> 'Garbage dump'::public.issue_category then raise exception 'Check the Fix transitions are limited to Garbage dump reports'; end if;
  if not (
    (v_from = 'reported' and p_to_status = 'under_review') or
    (v_from = 'new' and p_to_status = 'under_review') or
    (v_from = 'in_review' and p_to_status = 'under_review') or
    (v_from = 'needs_information' and p_to_status = 'under_review') or
    (v_from = 'closed_internal' and p_to_status = 'reopened') or
    (v_from = 'under_review' and p_to_status = 'needs_more_evidence') or
    (v_from = 'needs_more_evidence' and p_to_status = 'under_review') or
    (v_from = 'reopened' and p_to_status = 'under_review') or
    (v_from = 'action_reported' and p_to_status = 'resolution_verified')
  ) then raise exception 'Transition not permitted: % -> %', v_from, p_to_status; end if;
  update public.reports set internal_status = p_to_status, updated_at = now() where id = p_report_id;
  insert into public.report_history (report_id, actor_id, actor_role, internal_status_old, internal_status_new, note, created_at)
  values (p_report_id, v_uid, 'reviewer', v_from, p_to_status, btrim(p_reason), now());
end; $$;
revoke all on function public.transition_check_fix(uuid,text,text) from public, anon;
grant execute on function public.transition_check_fix(uuid,text,text) to authenticated;

-- Evidence registration is atomic with the lifecycle status and audit event.
create or replace function public.register_check_fix_evidence(
  p_report_id uuid, p_object_path text, p_action_note text, p_captured_at timestamptz,
  p_content_type text, p_byte_size bigint
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_status text; v_category public.issue_category; v_evidence_id uuid; v_actual_type text; v_actual_size bigint;
begin
  if v_uid is null or public.get_my_role() <> 'reviewer'::public.app_role then raise exception 'Reviewer role required' using errcode = '42501'; end if;
  if p_action_note is null or char_length(btrim(p_action_note)) not between 1 and 1200 then raise exception 'Action note is required'; end if;
  if p_object_path is null or split_part(p_object_path,'/',1) <> v_uid::text or split_part(p_object_path,'/',2) <> 'check-fix' or split_part(p_object_path,'/',3) <> p_report_id::text then raise exception 'Evidence path must be inside this reviewer/report folder' using errcode = '42501'; end if;
  if p_content_type not in ('image/jpeg','image/png','image/webp') or p_byte_size <= 0 or p_byte_size > 5242880 then raise exception 'Invalid evidence type or size'; end if;
  select o.metadata->>'mimetype', nullif(o.metadata->>'size','')::bigint into v_actual_type,v_actual_size from storage.objects o where o.bucket_id='civiclens-private-photos' and o.name=p_object_path;
  if not found then raise exception 'Uploaded after-photo was not found in private storage'; end if;
  if v_actual_type is distinct from p_content_type or v_actual_size is distinct from p_byte_size or v_actual_size <= 0 or v_actual_size > 5242880 then raise exception 'Uploaded file metadata does not match the registered type/size'; end if;
  select r.internal_status, r.category into v_status, v_category from public.reports r where r.id=p_report_id for update;
  if not found then raise exception 'Report not found'; end if;
  if v_category <> 'Garbage dump'::public.issue_category then raise exception 'Check the Fix currently supports Garbage dump reports only'; end if;
  if v_status not in ('under_review','needs_more_evidence') then raise exception 'Move the report into review before adding action evidence'; end if;
  insert into public.report_evidence(report_id,actor_id,evidence_kind,object_path,action_note,captured_at,content_type,byte_size)
  values(p_report_id,v_uid,'after',p_object_path,btrim(p_action_note),p_captured_at,p_content_type,p_byte_size) returning id into v_evidence_id;
  update public.reports set internal_status='action_reported',updated_at=now() where id=p_report_id;
  insert into public.report_history(report_id,actor_id,actor_role,internal_status_old,internal_status_new,note,created_at)
  values(p_report_id,v_uid,'reviewer',v_status,'action_reported','After-photo uploaded. '||btrim(p_action_note),now());
  return v_evidence_id;
end; $$;
revoke all on function public.register_check_fix_evidence(uuid,text,text,timestamptz,text,bigint) from public, anon;
grant execute on function public.register_check_fix_evidence(uuid,text,text,timestamptz,text,bigint) to authenticated;

-- AI assessments are appended against a specific immutable evidence version.
create or replace function public.save_check_fix_assessment(
  p_report_id uuid,p_evidence_id uuid,p_before_object_path text,p_comparable boolean,
  p_outcome text,p_rationale text,p_provider text,p_model text,p_created_by uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_before text; v_category public.issue_category; v_latest uuid; v_id uuid;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'Server-side assessment writer required' using errcode = '42501'; end if;
  if p_created_by is null or not exists (select 1 from public.user_roles ur where ur.user_id=p_created_by and ur.role='reviewer'::public.app_role) then raise exception 'Assessment actor must be an assigned reviewer' using errcode = '42501'; end if;
  if p_outcome not in ('possible_improvement','problem_may_remain','cannot_assess') then raise exception 'Unsupported assessment outcome'; end if;
  if p_rationale is null or char_length(btrim(p_rationale)) not between 1 and 1600 then raise exception 'Assessment rationale is required'; end if;
  select r.photo_object_path,r.category into v_before,v_category from public.reports r where r.id=p_report_id;
  if not found then raise exception 'Report not found'; end if;
  if v_category <> 'Garbage dump'::public.issue_category then raise exception 'AI Check the Fix is restricted to Garbage dump reports'; end if;
  if v_before is distinct from p_before_object_path then raise exception 'Before-photo version changed; refresh and reassess'; end if;
  select e.id into v_latest from public.report_evidence e where e.report_id=p_report_id order by e.uploaded_at desc,e.id desc limit 1;
  if v_latest is distinct from p_evidence_id or not exists (select 1 from public.report_evidence e where e.id=p_evidence_id and e.report_id=p_report_id) then raise exception 'After-photo version changed; refresh and reassess'; end if;
  insert into public.check_fix_assessments(report_id,evidence_id,before_object_path,comparable,outcome,rationale,provider,model,created_by,created_at)
  values(p_report_id,p_evidence_id,v_before,p_comparable,p_outcome,btrim(p_rationale),nullif(btrim(coalesce(p_provider,'')),''),nullif(btrim(coalesce(p_model,'')),''),p_created_by,now()) returning id into v_id;
  return v_id;
end; $$;
revoke all on function public.save_check_fix_assessment(uuid,uuid,text,boolean,text,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.save_check_fix_assessment(uuid,uuid,text,boolean,text,text,text,text,uuid) to service_role;

create or replace function public.respond_check_fix(p_report_id uuid,p_response text,p_note text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_reporter uuid; v_status text; v_category public.issue_category; v_id uuid;
begin
  if v_uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_response not in ('confirm_improvement','dispute') then raise exception 'Unsupported response'; end if;
  if char_length(coalesce(p_note,'')) > 1200 then raise exception 'Response note is too long'; end if;
  select r.reporter_id,r.internal_status,r.category into v_reporter,v_status,v_category from public.reports r where r.id=p_report_id for update;
  if not found or v_reporter <> v_uid then raise exception 'Only the original reporter can respond' using errcode='42501'; end if;
  if v_category <> 'Garbage dump'::public.issue_category then raise exception 'Check the Fix responses are limited to Garbage dump reports'; end if;
  if v_status not in ('action_reported','resolution_verified') then raise exception 'Reporter response is only available after action evidence is reported and before reopening'; end if;
  insert into public.check_fix_responses(report_id,actor_id,response,note,created_at) values(p_report_id,v_uid,p_response,btrim(coalesce(p_note,'')),now()) returning id into v_id;
  if p_response='dispute' and v_status <> 'reopened' then
    update public.reports set internal_status='reopened',updated_at=now() where id=p_report_id;
    insert into public.report_history(report_id,actor_id,actor_role,internal_status_old,internal_status_new,note,created_at)
    values(p_report_id,v_uid,'resident',v_status,'reopened','Original reporter disputed reported improvement. '||btrim(coalesce(p_note,'')),now());
  else
    insert into public.report_history(report_id,actor_id,actor_role,internal_status_old,internal_status_new,note,created_at)
    values(p_report_id,v_uid,'resident',v_status,v_status,case when p_response='confirm_improvement' then 'Original reporter confirmed visible improvement. ' else 'Original reporter repeated dispute. ' end||btrim(coalesce(p_note,'')),now());
  end if;
  return v_id;
end; $$;
revoke all on function public.respond_check_fix(uuid,text,text) from public, anon;
grant execute on function public.respond_check_fix(uuid,text,text) to authenticated;

-- Reviewer-only proximity suggestions: no semantic-AI claim; radius and time window are explicit.
create or replace function public.find_garbage_recurrence_candidates(
  p_new_report_id uuid,p_radius_m double precision default 150,p_lookback_days integer default 90
) returns table(prior_report_id uuid,prior_created_at timestamptz,prior_location_label text,distance_m double precision,reason text)
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_new public.reports%rowtype;
begin
  if v_uid is null or public.get_my_role() <> 'reviewer'::public.app_role then raise exception 'Reviewer role required' using errcode='42501'; end if;
  if p_radius_m is null or p_radius_m not between 1 and 1000 or p_lookback_days is null or p_lookback_days not between 1 and 365 then raise exception 'Radius must be 1–1000 metres and lookback 1–365 days'; end if;
  select * into v_new from public.reports r where r.id=p_new_report_id;
  if not found or v_new.category <> 'Garbage dump'::public.issue_category then raise exception 'A garbage report is required'; end if;
  return query
  select old.id,old.created_at,old.location_label,
    (6371000 * 2 * asin(sqrt(least(1.0,
      power(sin(radians((old.latitude-v_new.latitude)/2)),2) +
      cos(radians(v_new.latitude))*cos(radians(old.latitude))*power(sin(radians((old.longitude-v_new.longitude)/2)),2)
    ))))::double precision,
    'Garbage category; prior report marked resolution verified; within configured radius and lookback window.'::text
  from public.reports old
  where old.id<>v_new.id and old.category='Garbage dump'::public.issue_category
    and old.internal_status='resolution_verified' and old.data_class=v_new.data_class
    and old.created_at < v_new.created_at and old.created_at >= now() - make_interval(days=>p_lookback_days)
    and old.latitude is not null and old.longitude is not null and v_new.latitude is not null and v_new.longitude is not null
    and (6371000 * 2 * asin(sqrt(least(1.0,
      power(sin(radians((old.latitude-v_new.latitude)/2)),2) +
      cos(radians(v_new.latitude))*cos(radians(old.latitude))*power(sin(radians((old.longitude-v_new.longitude)/2)),2)
    )))) <= p_radius_m
  order by 4 asc limit 10;
end; $$;
revoke all on function public.find_garbage_recurrence_candidates(uuid,double precision,integer) from public, anon;
grant execute on function public.find_garbage_recurrence_candidates(uuid,double precision,integer) to authenticated;

create or replace function public.decide_garbage_recurrence(
  p_new_report_id uuid,p_prior_report_id uuid,p_decision text,p_note text default '',
  p_radius_m double precision default 150,p_lookback_days integer default 90
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_new public.reports%rowtype; v_prior public.reports%rowtype; v_id uuid;
begin
  if v_uid is null or public.get_my_role() <> 'reviewer'::public.app_role then raise exception 'Reviewer role required' using errcode='42501'; end if;
  if p_decision not in ('confirmed','rejected') then raise exception 'Decision must be confirmed or rejected'; end if;
  if char_length(coalesce(p_note,''))>1000 then raise exception 'Decision note is too long'; end if;
  if p_radius_m is null or p_radius_m not between 1 and 1000 or p_lookback_days is null or p_lookback_days not between 1 and 365 then raise exception 'Radius must be 1–1000 metres and lookback 1–365 days'; end if;
  select * into v_new from public.reports r where r.id=p_new_report_id;
  select * into v_prior from public.reports r where r.id=p_prior_report_id;
  if v_new.id is null or v_prior.id is null or v_new.id=v_prior.id then raise exception 'Both distinct reports must exist'; end if;
  if v_new.category<>'Garbage dump'::public.issue_category or v_prior.category<>'Garbage dump'::public.issue_category then raise exception 'Recurrence links are limited to garbage reports'; end if;
  if v_prior.internal_status<>'resolution_verified' or v_prior.created_at>=v_new.created_at or v_prior.created_at < now() - make_interval(days=>p_lookback_days) then raise exception 'Prior report must be resolved, predate the new report, and be within the configured lookback window'; end if;
  if v_prior.data_class<>v_new.data_class then raise exception 'Demo, test, and pilot records cannot be linked across data classes'; end if;
  if v_new.latitude is null or v_new.longitude is null or v_prior.latitude is null or v_prior.longitude is null then raise exception 'Both reports need coordinates; location metadata is not proof'; end if;
  if (6371000 * 2 * asin(sqrt(least(1.0,
    power(sin(radians((v_prior.latitude-v_new.latitude)/2)),2) + cos(radians(v_new.latitude))*cos(radians(v_prior.latitude))*power(sin(radians((v_prior.longitude-v_new.longitude)/2)),2)
  )))) > p_radius_m then raise exception 'Reports are outside the configured recurrence radius'; end if;
  insert into public.garbage_recurrence_decisions(new_report_id,prior_report_id,decision,decision_note,actor_id,decided_at)
  values(p_new_report_id,p_prior_report_id,p_decision,btrim(coalesce(p_note,'')),v_uid,now());
  insert into public.garbage_recurrence_links(new_report_id,prior_report_id,decision,decision_note,actor_id,decided_at)
  values(p_new_report_id,p_prior_report_id,p_decision,btrim(coalesce(p_note,'')),v_uid,now())
  on conflict(new_report_id,prior_report_id) do update set decision=excluded.decision,decision_note=excluded.decision_note,actor_id=excluded.actor_id,decided_at=excluded.decided_at
  returning id into v_id;
  return v_id;
end; $$;
revoke all on function public.decide_garbage_recurrence(uuid,uuid,text,text,double precision,integer) from public, anon;
grant execute on function public.decide_garbage_recurrence(uuid,uuid,text,text,double precision,integer) to authenticated;

-- Private bucket remains private; reviewer upload paths are scoped to their own auth UID.
drop policy if exists "CivicLens residents delete own orphan photos" on storage.objects;
drop policy if exists "CivicLens owners and reviewers read photos" on storage.objects;
create policy "CivicLens owners and reviewers read photos"
on storage.objects for select to authenticated
using (
  bucket_id='civiclens-private-photos'
  and (
    (storage.foldername(name))[1]=(select auth.uid())::text
    or public.get_my_role()='reviewer'::public.app_role
    or exists (
      select 1 from public.report_evidence e join public.reports r on r.id=e.report_id
      where e.object_path=storage.objects.name and r.reporter_id=(select auth.uid())
    )
  )
);

create policy "CivicLens residents delete own orphan photos"
on storage.objects for delete to authenticated
using (
  bucket_id='civiclens-private-photos'
  and (storage.foldername(name))[1]=(select auth.uid())::text
  and not exists (select 1 from public.reports r where r.photo_object_path=storage.objects.name)
  and not exists (select 1 from public.report_evidence e where e.object_path=storage.objects.name)
);

-- All new evidence, assessment, response, and recurrence tables are append-oriented for app users.
-- Project owners/service-role administrators remain privileged exceptions; this is not tamper-proof.


-- Keep the earlier generic reviewer action away from the garbage cleanup lifecycle.
create or replace function public.review_civic_report(p_report_id uuid,p_internal_status text,p_note text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_old_status text; v_category public.issue_category;
begin
  if v_uid is null or public.get_my_role() <> 'reviewer'::public.app_role then raise exception 'Reviewer role required' using errcode='42501'; end if;
  if p_internal_status not in ('new','in_review','needs_information','closed_internal') then raise exception 'Unsupported legacy internal status'; end if;
  if char_length(coalesce(p_note,''))>1000 then raise exception 'Review note is too long'; end if;
  select r.internal_status,r.category into v_old_status,v_category from public.reports r where r.id=p_report_id for update;
  if not found then raise exception 'Report not found'; end if;
  if v_category='Garbage dump'::public.issue_category then raise exception 'Garbage reports must use the Check the Fix lifecycle'; end if;
  if v_old_status=p_internal_status then raise exception 'Report already has this status'; end if;
  update public.reports set internal_status=p_internal_status,updated_at=now() where id=p_report_id;
  insert into public.report_history(report_id,actor_id,actor_role,internal_status_old,internal_status_new,note,created_at)
  values(p_report_id,v_uid,'reviewer',v_old_status,p_internal_status,btrim(coalesce(p_note,'')),now());
end; $$;
revoke all on function public.review_civic_report(uuid,text,text) from public, anon;
grant execute on function public.review_civic_report(uuid,text,text) to authenticated;
