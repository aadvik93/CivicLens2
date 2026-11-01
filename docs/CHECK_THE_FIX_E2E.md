# Check the Fix — staging verification

**Feature claim:** AI-assisted review of visible before/after garbage-cleanup evidence, human confirmation, and recurrence tracking for a scoped Greater Noida pilot. This is not physical verification, fraud detection, or official municipal integration.

## Lifecycle and permitted actors

| Current state | Action | Actor | Next state |
|---|---|---|---|
| Reported | Start review with reason | Reviewer | Under review |
| Under review | Request more evidence with reason | Reviewer | Needs more evidence |
| Needs more evidence | Resume review with reason | Reviewer | Under review |
| Under review / Needs more evidence | Register private after-photo and action note | Reviewer | Action reported |
| Action reported | Verify closure with recorded reason | Reviewer | Resolution verified |
| Action reported / Resolution verified | Confirm visible improvement | Original reporter | State unchanged; response event appended |
| Action reported / Resolution verified | Dispute | Original reporter | Reopened; response and history appended |
| Reopened | Resume review with reason | Reviewer | Under review |

Only a reviewer can verify closure. Reporter confirmation does not close a report or grant reviewer privileges. Existing generic status RPC is blocked from garbage reports by migration 003.

## Setup sequence

1. Use a new/staging Supabase project. Back up any existing project before applying changes.
2. Apply `001_initial_schema.sql`, then `002_authenticated_reporting_workflow.sql`, then `003_check_the_fix.sql` in order. These scripts have not been executed against PostgreSQL in this environment; validate on staging first.
3. Configure frontend `.env` using only the project URL and publishable/anon key.
4. Deploy `supabase/functions/check-fix-assess` only after the project owner approves use of a paid vision API. Configure `OPENAI_API_KEY`, `OPENAI_VISION_MODEL`, `CHECK_FIX_AI_ENABLED=true`, and an appropriate `CHECK_FIX_ALLOWED_ORIGIN` as Supabase function secrets. Never put these values in Vite env variables. Leave AI disabled until approved. No model calls occur when `CHECK_FIX_AI_ENABLED` is not `true`.
5. Grant reviewer role only through trusted admin SQL, never through the resident UI. For a known test account, inspect the exact auth user ID first, then use an authorized project owner session to insert a row into `public.user_roles` with `role='reviewer'` and `granted_by` set to the administrator ID.

## Manual test accounts

Create Resident A, Resident B, and Reviewer C in Supabase Auth. Grant only Reviewer C the reviewer role. Do not use real resident or civic data during this test. Keep all test reports tagged `test`.

1. Resident A creates a garbage report with a private before-photo and confirmed coordinates.
2. Refresh Resident A's browser and verify the report, photo link, initial history event, and `reported` state persist.
3. Sign in as Resident B. Verify A's report and evidence are not visible or mutable.
4. Sign in as Reviewer C. Verify A's report appears in the queue and the private before-photo opens through a temporary signed URL.
5. Try direct browser table insert/update/delete against `reports`, `report_history`, `report_evidence`, `check_fix_assessments`, `check_fix_responses`, `garbage_recurrence_links`, and `user_roles`. Each protected write should be rejected.
6. As Reviewer C, transition `reported → under_review` with a reason. Upload a JPG/PNG/WebP after-photo with a factual note and optional capture time. Verify a new object exists in the private bucket and prior photos remain.
7. Verify uploaded timestamp is server-generated; capture time is explicitly labelled unverified. Try uploading a file over 5 MB or unsupported MIME type; client and backend should reject it.
8. If AI is not enabled, invoke the endpoint and verify a manual-review fallback, not keyword matching. If paid API use is approved and enabled, test comparable cleanup, visible garbage remaining, unrelated photos, obstruction, timeout, and malformed provider response. The model must be able to abstain. AI output must not close the report.
9. As Resident A, confirm improvement. Verify response actor/time is recorded but state remains `action_reported`. As reviewer, verify closure with a reason; state becomes `resolution_verified`.
10. As Resident A, dispute a reported action. Verify `reopened`, preserve earlier confirmation/verification records, and allow reviewer to resume review.
11. Upload a second after-photo. Verify the prior AI assessment remains historical but is no longer current for the latest evidence ID.
12. Create a new nearby garbage report and separately create a nearby pothole or garbage report with distant/incorrect coordinates. Verify recurrence suggestions only use garbage category, same data class, prior `resolution_verified`, 150 m radius, and 90-day lookback. Confirm/reject the suggestion; the new report ID and lifecycle remain separate. Verify only confirmed links count as recurrence.
13. Repeat a submission with the same idempotency key; verify no second report is created.
14. Sign out and attempt access. Verify data is not exposed to unauthenticated users.

## Evidence to capture

Record each case with: test ID, environment, account role, report IDs (test only), expected result, actual result, timestamp, PASS/FAIL/NOT TESTED, and sanitized error evidence. Never include passwords, access tokens, or private API keys.

## Evaluation matrix template

| Pair ID | Independent label | Same place/view? | Visible garbage reduced? | Model output | Human decision | Rationale | Latency ms | Error/abstention | Reviewer |
|---|---|---|---|---|---|---|---:|---|---|
| TO BE COLLECTED | TO BE COLLECTED | TO BE COLLECTED | TO BE COLLECTED | NOT TESTED | TO BE COLLECTED | TO BE COLLECTED | NOT TESTED | NOT TESTED | TO BE COLLECTED |

Independent labels must be made by a human who did not use the model output to assign the label. Report sample size and category-wise results; do not invent accuracy or confidence percentages.

## Status ledger (current environment)

- Code implementation: present in repository, not deployed.
- Pure helper logic: PASS, 14 runtime assertions; the Vitest suite itself is NOT RUN because dependencies are missing.
- Static SQL guard checks: PASS, 29/29 markers; they do not parse or execute PostgreSQL.
- Local PostgreSQL tests: NOT TESTED (no `psql`/PostgreSQL service available in this environment at last inspection).
- Hosted API tests: NOT TESTED (no connected Supabase project credentials).
- Live browser tests: NOT TESTED.
- Real field evaluation: NOT TESTED.
