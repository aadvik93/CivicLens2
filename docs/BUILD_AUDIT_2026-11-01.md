# CivicLens build audit — 1 November 2026

## Source baseline

- Recovered repository backup: `CivicLens_Check_the_Fix_Repository_Backup.tar.gz`
- Git commit: `f4daa05ec32d53382b5ce5da739751f6a84f2d44` (`Add Check the Fix evidence review workflow`)
- The recovered Git working tree was clean before this audit.
- No `.env` file, Supabase project credentials, or live project connection was present.

## Existing scope retained

The application scope was not expanded. The reviewed code includes Supabase Auth, private photo upload, resident reporting, GPS/manual coordinate confirmation, editable English/Hindi complaint drafts, resident reports, reviewer-only internal review, append-only status history, and the garbage-only Check the Fix evidence workflow. Vision assessment remains optional and disabled until the project owner configures it. The application does not currently provide a real interactive map or automatic AI classification in the resident reporting form; these remain known limitations rather than newly added work.

## Defects corrected in this audit

1. The `transition_check_fix` RPC previously relied on the UI to call it only for garbage reports. A reviewer could call the RPC directly for another category and attempt to apply Check the Fix statuses. The function now verifies the report category inside the database transaction.
2. The `respond_check_fix` RPC now also enforces the garbage-only scope at the database boundary.
3. Report retries now derive a payload fingerprint. An unchanged retry keeps the same idempotency key; changing report fields or selected photo metadata starts a new submission key, preventing an edited form from silently resolving to an earlier report created under the old key.
4. The optional vision Edge Function no longer defaults to wildcard CORS. Browser requests require an exact configured `CHECK_FIX_ALLOWED_ORIGIN`; without it, cross-origin browser calls are denied and manual review remains available.

## Verification performed

| Check | Result | Evidence / limitation |
|---|---|---|
| Static migration guard | PASS | `python3 scripts/check_migrations.py` — 31/31 string-marker checks. This is not SQL parsing or PostgreSQL execution. |
| TypeScript/TSX syntax transpilation | PASS | 10 `.ts`/`.tsx` source, test, and Edge Function files parsed/transpiled with the globally installed TypeScript compiler. Semantic type-check was not performed. |
| Focused pure-logic runtime assertions | PASS | 7 assertions covering transition rules, distance/recurrence logic, vision abstention, and retry fingerprint stability/change. |
| `npm install --no-audit --no-fund` | BLOCKED | npm registry request failed with `EAI_AGAIN`; no dependencies were installed. |
| `npm test` | NOT RUN | `vitest` executable unavailable because dependencies are not installed. |
| `npm run build` | BLOCKED | Project dependencies and React type declarations are unavailable. The resulting missing-module/type errors are environment/dependency errors; a valid production build was not produced. |
| SQL execution against PostgreSQL | NOT TESTED | No local PostgreSQL/Supabase runtime was available. |
| Hosted Supabase API / storage | NOT TESTED | No project URL, anon key, or authorized project access supplied. |
| Two-resident + reviewer browser workflow | NOT TESTED | Requires a configured staging project and three separate accounts. |
| Deployment | NOT TESTED | No deployment was attempted. |

## Required next verification on a network-enabled machine

From the extracted project directory:

```bash
npm install
npm test
npm run check:migrations
npm run build
```

Then configure a **new or backed-up staging Supabase project**, apply migrations in order, and complete the account/permission test plan in `docs/SUPABASE_SETUP_AND_E2E_TEST.md` and `docs/CHECK_THE_FIX_E2E.md`. Do not apply migrations to a live/legacy project until its schema and backup have been inspected. Do not enable the paid vision API without explicit approval.

## Scope and deployment statement

This audit is a source-code review and partial local verification only. It does not establish that the application is production-ready, that SQL migrations execute successfully, that a hosted workflow works, or that the project is deployed.
