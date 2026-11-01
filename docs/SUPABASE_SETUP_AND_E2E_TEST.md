# Supabase setup and end-to-end verification

## Before applying migrations

The working copy is version-controlled locally. A fresh pre-feature snapshot exists at `/mnt/data/CivicLens_before_check_the_fix_20261030T184950Z.tar.gz`; earlier starter snapshots are also preserved in `/mnt/data`. The migrations target a new/staging Supabase project. Migration 003 adds tables, functions, policies, and status constraints without deleting report/evidence/history rows, but it should still be applied only after backup and schema review.

## Apply migrations

In Supabase Dashboard → SQL Editor, run these files in order:

1. `supabase/migrations/001_initial_schema.sql`
2. `supabase/migrations/002_authenticated_reporting_workflow.sql`
3. `supabase/migrations/003_check_the_fix.sql`

The bucket is private. Only a signed-in user may upload into an object path beginning with their own auth UUID. A reviewer can read report photos through the bucket's SELECT policy and temporary signed URLs. Residents can delete only their own orphan photos that are not referenced by a report or evidence row. The original reporter can read an after-photo once it is registered to their report, even though the object path is scoped to the reviewer uploader. Direct report/history/role writes from browser clients are revoked; writes occur through constrained functions.

## Configure the frontend

Create `.env` from `.env.example` and set only the Project URL and anon/publishable key. Never use the service-role key in browser code. Restart Vite after editing `.env`.

## Create two accounts

1. Sign up a resident account in CivicLens.
2. Sign up a separate reviewer account in CivicLens.
3. In Supabase SQL Editor, replace the reviewer email below with the exact account email and run this one-time administrator action:

```sql
insert into public.user_roles (user_id, role, granted_at)
select id, 'reviewer'::public.app_role, now()
from auth.users
where lower(email) = lower('REPLACE_WITH_REVIEWER_EMAIL')
on conflict (user_id) do update set role = 'reviewer'::public.app_role, granted_at = now();
```

Only a trusted project administrator should run this. No self-service role assignment exists in the app.

## Manual end-to-end test

Use two separate browser profiles (or one regular and one private window):

1. Sign in as resident A.
2. Create a report with a JPG/PNG/WebP photo under 5 MB, select a category, enter/obtain coordinates, click **Confirm coordinates**, then save.
3. Record the report reference and confirm it appears under **My reports** after a refresh.
4. Sign in as the separately authorized reviewer in the second browser profile. Open **Reviewer queue** and verify the report is visible.
5. For a garbage report, move `Reported → Under review`, upload an after-photo with an action note, and verify status becomes `Action reported`. For other categories, use the manual reviewer status control.
6. Return to resident A, refresh **My reports**, compare before/after photos, and confirm improvement or dispute. Verify the response, actor role, server-generated timestamp, and history are retained. Reviewer closure requires a reason and moves `Action reported → Resolution verified`.
7. Sign in as resident B and verify resident A's report is not returned.
8. Attempt to call reviewer-only status/evidence/recurrence RPCs as resident A; they must fail with permission denied. Try direct inserts/updates/deletes to evidence, assessment, response, recurrence, report-history, report, and role tables; protected writes must be rejected.
9. Sign out and verify report reads/RPC calls fail without authentication.
10. Verify the photo bucket is private in Supabase Storage. A signed URL should expire after 180 seconds.

## Test classification

- Pure helper TypeScript type-check: PASS using global TypeScript compiler.
- Pure Check the Fix helper logic: PASS, 14 runtime assertions; this does not exercise React, Supabase, PostgreSQL, or the Edge Function runtime.
- TypeScript/TSX syntax parse: PASS, 11 files parsed with zero syntax errors.
- Static SQL guard checks: PASS, 29/29 markers; this is not SQL parsing or execution.
- Unit tests: `npm test` — NOT RUN; `vitest` is not installed.
- Frontend production build: `npm run build` — BLOCKED because React, Supabase JS, Lucide, and their type packages are not installed. Missing-dependency errors prevent a meaningful full type-check.
- Hosted database/API tests: NOT TESTED until the migrations are applied to a Supabase staging project.
- Two-account browser workflow: NOT TESTED until configured and executed as above.

## Important data classification

New reports default to `data_class = 'test'`, not `pilot`. A trusted administrator must verify a genuine pilot report and change its classification using an approved administrative procedure before including it in pilot metrics. Demo/test/pilot counts must not be mixed silently.

## Known limits

- The vision endpoint is implemented server-side but is not deployed/configured; AI stays disabled until an administrator explicitly enables it and approves provider usage. No interactive map is connected in this workflow.
- Statuses are internal CivicLens review states, not official acknowledgement or government resolution.
- The report/photo upload sequence is a two-step client flow. On an RPC/network failure, the client retains the idempotency key and does not automatically delete the uploaded object because the database transaction may have committed despite a lost response. This can leave a private orphan photo for administrative cleanup; the storage delete policy prevents residents from deleting photos already referenced by reports.
- The database owner/service role can bypass normal RLS controls; the system is not tamper-proof.
