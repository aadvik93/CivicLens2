# CivicLens

Authenticated civic issue reporting prototype for the DTU SEVA First Innovation Challenge 2026.

**Team:** kaaliFortuner · **Pilot area:** Greater Noida, Uttar Pradesh

## Current implementation

The application now uses Supabase Auth, PostgreSQL, and a private Storage bucket for the core workflow. It includes resident sign-up/sign-in, actual photograph upload, category selection, GPS/manual coordinates with explicit confirmation, editable English/Hindi complaint drafts, a database-backed report list, reviewer-only internal status changes, and server-generated status history.

**The hosted workflow is not yet verified.** The recovered source backup is at Git commit `f4daa05` (working tree was clean before this audit). This environment has no `.env` or Supabase project details. `npm install` was attempted but the npm registry could not be reached (`EAI_AGAIN`), so `npm test` and `npm run build` could not run with project dependencies. The dependency-free migration guard checks expected security markers but does not parse or execute SQL. Hosted API and two-account browser tests are NOT TESTED until a staging project is configured. See [`docs/BUILD_AUDIT_2026-11-01.md`](docs/BUILD_AUDIT_2026-11-01.md) for the exact results.

## Preserve/rollback

Before editing, the original starter was preserved as:

- `CivicLens_Starter_Project.before-auth-storage.zip`
- `CivicLens_repository_before_auth_storage.tar.gz`

These files are in the parent working directory (`/mnt/data`), not part of the application bundle. A fresh working-copy snapshot was also created before this completion pass.

## Setup

1. Install Node.js 22.12+ (current environment used Node 22.16.0).
2. Copy `.env.example` to `.env` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from a new/staging Supabase project. Never use a service-role key in browser code.
3. In Supabase SQL Editor, run migrations in order:
   - `supabase/migrations/001_initial_schema.sql`
   - `supabase/migrations/002_authenticated_reporting_workflow.sql`
   - `supabase/migrations/003_check_the_fix.sql`
4. Install and run:

```bash
npm install
npm run check:migrations
npm test
npm run build
npm run dev
```

5. Sign up a resident and a separate reviewer account. Grant reviewer role only through a trusted administrator using the SQL in `docs/SUPABASE_SETUP_AND_E2E_TEST.md`.
6. Complete the multi-account test plan in `docs/SUPABASE_SETUP_AND_E2E_TEST.md` and `docs/CHECK_THE_FIX_E2E.md`.

## Security design

- Ownership is derived from `auth.uid()` inside `create_civic_report`; client-supplied reporter IDs are not accepted.
- Browser clients have no direct write/delete privileges on `reports`, `report_history`, or `user_roles`.
- Report creation and initial history insertion occur in one database function transaction. Retries with an unchanged form payload reuse the same idempotency key; changing the payload starts a distinct submission.
- Reviewer-only status changes and audit history insertion occur in one database function transaction.
- Status history is append-only for application users.
- Photo bucket is private; storage paths must begin with the uploader's auth UUID. Reviewer photo access is checked by a storage SELECT policy and is surfaced as short-lived signed URLs.
- New reports default to `data_class = 'test'` until an authorized process verifies them for pilot metrics.
- Database owners and privileged service roles can bypass normal RLS; the system is not tamper-proof.

## Verification status

- TypeScript/TSX syntax transpilation: PASS (10 source/test/Edge Function files; syntax only, not semantic type-checking).
- Focused pure-logic runtime assertions: PASS (7 assertions).
- Static SQL guard checks: PASS (31/31 markers; not SQL parsing or execution).
- `npm install`: BLOCKED by npm registry DNS/network error (`EAI_AGAIN`).
- Vitest suite: NOT RUN (`vitest` dependency unavailable).
- Production build: BLOCKED (React, Supabase, and other project dependencies unavailable).
- PostgreSQL migration execution, hosted API, live browser workflow, and field evaluation: NOT TESTED.

## Known limits

- The vision endpoint code exists but is not deployed/configured, and AI remains disabled unless explicitly enabled by a project administrator. No interactive map is connected.
- Internal status is not an official government acknowledgement, dispatch, or resolution.
- The report workflow uses a two-step photo-upload/database-create sequence. A network failure can leave a private orphan photo, which must be cleaned up carefully after verifying no report references it.
- Do not run migrations against an existing project until its schema and backups have been inspected. These migrations are intended for a new/staging project and do not import legacy data.


## Check the Fix

The garbage-only workflow is documented in [`docs/CHECK_THE_FIX_E2E.md`](docs/CHECK_THE_FIX_E2E.md). It keeps the original report photo unchanged, stores after-photos separately in private Storage, binds advisory vision assessments to the exact after-evidence ID and before-photo path, records reporter confirmation/disputes, restricts closure verification to reviewers, and supports human-confirmed recurrence links using category/data-class/status plus a 150 m / 90-day default rule. Recurrence matching is proximity-based, not semantic AI.

The server-side vision endpoint is in `supabase/functions/check-fix-assess`. AI is disabled unless the project owner explicitly sets `CHECK_FIX_AI_ENABLED=true` and configures server-side provider secrets. Browser calls require an exact `CHECK_FIX_ALLOWED_ORIGIN`; wildcard CORS is not used. The Edge Function uses the service-role key only server-side to save model output; ordinary browser clients cannot invoke the assessment-save RPC. Do not enable paid provider usage without approval. When unavailable, the UI offers manual review; it does not substitute keyword matching.

Competition drafts and the architecture diagram are in `docs/COMPETITION_DRAFTS.md` and `docs/ARCHITECTURE.md`. The official slide template and field-evidence inputs remain outstanding.
