-- CivicLens authenticated reporting workflow.
-- Apply after 001_initial_schema.sql in a NEW/staging Supabase project.
-- This migration does not import, delete, or rewrite legacy report rows.

alter table public.reports
  add column if not exists internal_status text not null default 'new',
  add column if not exists location_accuracy_m double precision;

alter table public.reports drop constraint if exists reports_internal_status_check;
alter table public.reports add constraint reports_internal_status_check
  check (internal_status in ('new', 'in_review', 'needs_information', 'closed_internal'));

alter table public.report_history
  alter column new_status drop not null,
  add column if not exists internal_status_old text,
  add column if not exists internal_status_new text;

alter table public.report_history drop constraint if exists report_history_internal_status_old_check;
alter table public.report_history add constraint report_history_internal_status_old_check
  check (internal_status_old is null or internal_status_old in ('new', 'in_review', 'needs_information', 'closed_internal'));
alter table public.report_history drop constraint if exists report_history_internal_status_new_check;
alter table public.report_history add constraint report_history_internal_status_new_check
  check (internal_status_new is null or internal_status_new in ('new', 'in_review', 'needs_information', 'closed_internal'));

create index if not exists reports_reporter_created_idx on public.reports(reporter_id, created_at desc);
create index if not exists report_history_report_created_idx on public.report_history(report_id, created_at asc);

-- No browser role can write protected report or audit fields directly.
revoke insert, update, delete, truncate, references, trigger on public.reports from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.report_history from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.user_roles from anon, authenticated;
grant select on public.reports to authenticated;
grant select on public.report_history to authenticated;
grant select on public.user_roles to authenticated;

-- Return only the role assigned by a trusted administrator. There is no self-service role mutation.
create or replace function public.get_my_role()
returns public.app_role
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select ur.role from public.user_roles ur where ur.user_id = (select auth.uid())),
    'resident'::public.app_role
  );
$$;
revoke all on function public.get_my_role() from public, anon;
grant execute on function public.get_my_role() to authenticated;

-- Creates the report and initial history atomically. Ownership comes only from auth.uid().
create or replace function public.create_civic_report(
  p_id uuid,
  p_idempotency_key uuid,
  p_category public.issue_category,
  p_description text,
  p_complaint_text text,
  p_complaint_language text,
  p_location_label text,
  p_latitude double precision,
  p_longitude double precision,
  p_location_accuracy_m double precision,
  p_photo_object_path text
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_report_id uuid;
begin
  if v_uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_category is null then raise exception 'Category is required'; end if;
  if p_description is null or char_length(btrim(p_description)) not between 1 and 1200 then
    raise exception 'Description must contain 1 to 1200 characters';
  end if;
  if p_complaint_language not in ('English', 'Hindi') then raise exception 'Unsupported complaint language'; end if;
  if p_latitude is null or p_latitude < -90 or p_latitude > 90
     or p_longitude is null or p_longitude < -180 or p_longitude > 180 then
    raise exception 'Valid coordinates are required';
  end if;
  if p_id is null or p_idempotency_key is null then raise exception 'Report and idempotency IDs are required'; end if;
  if p_photo_object_path is null or split_part(p_photo_object_path, '/', 1) <> v_uid::text then
    raise exception 'Photo path must belong to the signed-in resident' using errcode = '42501';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'civiclens-private-photos' and o.name = p_photo_object_path
  ) then raise exception 'Uploaded photo was not found in private storage'; end if;

  insert into public.reports (
    id, reporter_id, category, description, complaint_text, complaint_language,
    location_label, latitude, longitude, location_accuracy_m, photo_object_path,
    internal_status, data_class, idempotency_key, created_at, updated_at
  ) values (
    p_id, v_uid, p_category, btrim(p_description), coalesce(p_complaint_text, ''), p_complaint_language,
    coalesce(p_location_label, ''), p_latitude, p_longitude, p_location_accuracy_m, p_photo_object_path,
    'new', 'test', p_idempotency_key, now(), now()
  )
  on conflict (reporter_id, idempotency_key) do nothing
  returning id into v_report_id;

  if v_report_id is null then
    select r.id into v_report_id from public.reports r
    where r.reporter_id = v_uid and r.idempotency_key = p_idempotency_key;
    return v_report_id;
  end if;

  insert into public.report_history (
    report_id, actor_id, old_status, new_status, internal_status_old, internal_status_new, note, created_at
  ) values (
    v_report_id, v_uid, null, 'Report created'::public.report_status, null, 'new', 'Report created by resident.', now()
  );
  return v_report_id;
end;
$$;
revoke all on function public.create_civic_report(uuid, uuid, public.issue_category, text, text, text, text, double precision, double precision, double precision, text) from public, anon;
grant execute on function public.create_civic_report(uuid, uuid, public.issue_category, text, text, text, text, double precision, double precision, double precision, text) to authenticated;

-- Reviewer-only status update and append-only history insert happen in the same transaction.
create or replace function public.review_civic_report(
  p_report_id uuid,
  p_internal_status text,
  p_note text default ''
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_old_status text;
begin
  if v_uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if public.get_my_role() <> 'reviewer'::public.app_role then
    raise exception 'Reviewer role required' using errcode = '42501';
  end if;
  if p_internal_status not in ('new', 'in_review', 'needs_information', 'closed_internal') then
    raise exception 'Unsupported internal status';
  end if;
  if char_length(coalesce(p_note, '')) > 1000 then raise exception 'Review note must be 1000 characters or fewer'; end if;

  select r.internal_status into v_old_status
  from public.reports r where r.id = p_report_id for update;
  if not found then raise exception 'Report not found'; end if;
  if v_old_status = p_internal_status then raise exception 'Report already has this status'; end if;

  update public.reports set internal_status = p_internal_status, updated_at = now() where id = p_report_id;
  insert into public.report_history (
    report_id, actor_id, old_status, new_status, internal_status_old, internal_status_new, note, created_at
  ) values (
    p_report_id, v_uid, null, null,
    v_old_status, p_internal_status, btrim(coalesce(p_note, '')), now()
  );
end;
$$;
revoke all on function public.review_civic_report(uuid, text, text) from public, anon;
grant execute on function public.review_civic_report(uuid, text, text) to authenticated;

-- Private photo bucket: actual bytes are stored here, never in a public bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('civiclens-private-photos', 'civiclens-private-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "CivicLens residents upload own photos" on storage.objects;
create policy "CivicLens residents upload own photos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'civiclens-private-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "CivicLens owners and reviewers read photos" on storage.objects;
create policy "CivicLens owners and reviewers read photos"
on storage.objects for select to authenticated
using (
  bucket_id = 'civiclens-private-photos'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or public.get_my_role() = 'reviewer'::public.app_role
  )
);

drop policy if exists "CivicLens residents delete own orphan photos" on storage.objects;
create policy "CivicLens residents delete own orphan photos"
on storage.objects for delete to authenticated
using (
  bucket_id = 'civiclens-private-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and not exists (
    select 1 from public.reports r where r.photo_object_path = storage.objects.name
  )
);

-- History is append-only for application users: no direct write/delete grants or policies.
-- Trusted project administrators can still exercise exceptional database-owner privileges.
