-- CivicLens initial schema. Apply only to a NEW/staging Supabase project after review.
create extension if not exists pgcrypto;

create type public.app_role as enum ('resident', 'reviewer', 'viewer');
create type public.report_data_class as enum ('demo', 'test', 'pilot');
create type public.issue_category as enum (
  'Garbage dump', 'Pothole', 'Waterlogging', 'Broken streetlight', 'Open drain', 'Other / Needs review'
);
create type public.report_status as enum (
  'Report created', 'Complaint prepared', 'Submitted externally',
  'Acknowledged', 'Action reported', 'Resolution verified', 'Reopened'
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'resident',
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now()
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id),
  category public.issue_category not null,
  description text not null check (char_length(description) between 1 and 1200),
  complaint_text text not null default '',
  complaint_language text not null default 'English' check (complaint_language in ('English','Hindi')),
  location_label text not null default '',
  latitude double precision,
  longitude double precision,
  location_accuracy_m double precision,
  photo_object_path text,
  status public.report_status not null default 'Report created',
  data_class public.report_data_class not null default 'pilot',
  priority_score integer not null default 1 check (priority_score between 1 and 5),
  priority_reason text not null default 'Default baseline; reviewer may reassess.',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  idempotency_key uuid not null,
  unique (reporter_id, idempotency_key),
  check (latitude is null or latitude between -90 and 90),
  check (longitude is null or longitude between -180 and 180)
);

create table public.report_history (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.reports(id),
  actor_id uuid not null references auth.users(id),
  old_status public.report_status,
  new_status public.report_status not null,
  note text not null default '',
  evidence_object_path text,
  created_at timestamptz not null default now()
);

create table public.report_feedback (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id),
  user_id uuid not null references auth.users(id),
  feedback_type text not null check (feedback_type in ('helpful','duplicate','follow_up')),
  created_at timestamptz not null default now(),
  unique (report_id, user_id, feedback_type)
);

create index reports_created_at_idx on public.reports(created_at desc);
create index reports_category_idx on public.reports(category);
create index reports_location_idx on public.reports(latitude, longitude);

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.reports enable row level security;
alter table public.report_history enable row level security;
alter table public.report_feedback enable row level security;

create or replace function public.current_app_role()
returns public.app_role
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select ur.role from public.user_roles ur where ur.user_id = (select auth.uid())),
    'resident'::public.app_role
  );
$$;
revoke all on function public.current_app_role() from public, anon;
grant execute on function public.current_app_role() to authenticated;

create policy "profile owner can read own profile"
on public.profiles for select to authenticated
using (user_id = (select auth.uid()));

create policy "profile owner can insert own profile"
on public.profiles for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "user can read own role; reviewers can read roles"
on public.user_roles for select to authenticated
using (user_id = (select auth.uid()) or public.current_app_role() = 'reviewer');

-- Do not grant users direct INSERT/UPDATE to protected report columns.
-- Inserts and edits are intended to go through constrained RPC functions added next.
create policy "resident reads own reports"
on public.reports for select to authenticated
using (reporter_id = (select auth.uid()));

create policy "reviewer reads reports"
on public.reports for select to authenticated
using (public.current_app_role() = 'reviewer');

create policy "viewer reads only eligible pilot reports"
on public.reports for select to authenticated
using (public.current_app_role() = 'viewer' and data_class = 'pilot');

create policy "reporter reads own history"
on public.report_history for select to authenticated
using (exists (
  select 1 from public.reports r
  where r.id = report_history.report_id and r.reporter_id = (select auth.uid())
));

create policy "reviewer reads history"
on public.report_history for select to authenticated
using (public.current_app_role() = 'reviewer');

create policy "user reads own feedback"
on public.report_feedback for select to authenticated
using (user_id = (select auth.uid()));

-- Intentionally no direct insert/update/delete policies on report_history or user_roles.
-- Storage bucket and restricted transactional RPC functions are added in a subsequent migration.
-- A database owner/service role can bypass ordinary RLS; this is not tamper-proof.
