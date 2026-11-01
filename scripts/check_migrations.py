"""Dependency-free safety guardrails; not a SQL parser or PostgreSQL runtime test."""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "supabase" / "migrations"
files = sorted(MIGRATIONS.glob("*.sql"))
expected = ["001_initial_schema.sql", "002_authenticated_reporting_workflow.sql", "003_check_the_fix.sql"]
texts = {p.name: p.read_text().lower() for p in files}
m1, m2, m3 = (texts.get(name, "") for name in expected)
all_sql = "\n".join(texts.values())
checks = []

def check(name: str, ok: bool) -> None:
    checks.append((name, bool(ok)))

check("migrations exist in required sequence", [p.name for p in files] == expected)
table_defs = [(name.lower(), file_name) for file_name, body in texts.items() for name in re.findall(r"create\s+table\s+(?:if\s+not\s+exists\s+)?([\w.]+)", body)]
check("no duplicate table creation across migrations", len([name for name, _ in table_defs]) == len(set(name for name, _ in table_defs)))
policy_defs = [(name.lower(), file_name) for file_name, body in texts.items() for name in re.findall(r'create\s+policy\s+"([^"]+)"', body)]
policy_recreation_safe = True
for policy_name in set(name for name, _ in policy_defs):
    defining_files = [file_name for name, file_name in policy_defs if name == policy_name]
    if len(defining_files) > 1:
        for file_name in defining_files[1:]:
            if not re.search(r'drop\s+policy\s+if\s+exists\s+"' + re.escape(policy_name) + r'"', texts[file_name]):
                policy_recreation_safe = False
check("duplicate policy names are explicitly dropped before recreation", policy_recreation_safe)
for table in ("profiles", "user_roles", "reports", "report_history", "report_feedback"):
    check(f"001 creates {table}", f"create table public.{table}" in m1)
check("report ownership comes from auth.uid()", "v_uid uuid := auth.uid()" in m2 and "reporter_id, category" in m2)
check("report creation validates private uploaded object", "storage.objects o" in m2 and "civiclens-private-photos" in m2)
check("report creation is idempotent", "on conflict (reporter_id, idempotency_key) do nothing" in m2)
check("review RPC checks reviewer role", "public.get_my_role() <> 'reviewer'::public.app_role" in m2)
check("status and history are transactional in RPC", "update public.reports set internal_status" in m2 and "insert into public.report_history" in m2)
check("security-definer functions set empty search_path", len(re.findall(r"security definer\s+set search_path = ''", all_sql)) >= 8)
check("browser writes revoked for protected core tables", all(f"on public.{t} from anon, authenticated" in m2 for t in ("reports", "report_history", "user_roles")))
check("private bucket is configured", "values ('civiclens-private-photos', 'civiclens-private-photos', false" in m2)
check("orphan-photo deletion excludes report and evidence references", "not exists (select 1 from public.report_evidence e where e.object_path=storage.objects.name)" in m3)
check("Check the Fix preserves all evidence versions", "create table if not exists public.report_evidence" in m3 and "unique" in m3)
check("AI output is tied to exact evidence version", "v_latest is distinct from p_evidence_id" in m3 and "v_before is distinct from p_before_object_path" in m3)
check("AI save RPC accepts service role only", "coalesce(auth.jwt()->>'role','') <> 'service_role'" in m3 and "from public, anon, authenticated" in m3 and "to service_role" in m3)
check("reporter can read after-photos stored under reviewer path", "where e.object_path=storage.objects.name and r.reporter_id=(select auth.uid())" in m3)
check("recurrence decision history is append-only", "create table if not exists public.garbage_recurrence_decisions" in m3 and "insert into public.garbage_recurrence_decisions" in m3)
check("new evidence records action and changes status transactionally", "register_check_fix_evidence" in m3 and "'action_reported'" in m3 and "insert into public.report_history" in m3)
check("reporter response is owner-only and dispute reopens", "v_reporter <> v_uid" in m3 and "'reopened'" in m3)
check("recurrence uses category, data class, distance and lookback", "find_garbage_recurrence_candidates" in m3 and "p_radius_m" in m3 and "p_lookback_days" in m3 and "old.data_class=v_new.data_class" in m3)
check("generic reviewer RPC cannot bypass garbage workflow", "garbage reports must use the check the fix lifecycle" in m3)
transition_fn = m3.split("create or replace function public.transition_check_fix", 1)[1].split("-- Evidence registration", 1)[0]
response_fn = m3.split("create or replace function public.respond_check_fix", 1)[1].split("-- Reviewer-only proximity", 1)[0]
check("Check the Fix transition RPC is restricted to garbage reports", "v_category public.issue_category" in transition_fn and "select r.internal_status, r.category into v_from, v_category" in transition_fn and "check the fix transitions are limited to garbage dump reports" in transition_fn)
check("Check the Fix reporter response RPC is restricted to garbage reports", "v_category public.issue_category" in response_fn and "select r.reporter_id,r.internal_status,r.category into v_reporter,v_status,v_category" in response_fn and "check the fix responses are limited to garbage dump reports" in response_fn)
check("no drop table statements", not re.search(r"\bdrop\s+table\b", all_sql))
check("no truncate of protected report data", not re.search(r"\btruncate\s+(?:table\s+)?public\.(?:reports|report_history|user_roles|report_evidence|check_fix_assessments)\b", all_sql))
check("no direct delete from report data", not re.search(r"\bdelete\s+from\s+public\.(?:reports|report_history|user_roles|report_evidence|check_fix_assessments)\b", all_sql))

for name, ok in checks:
    print(f"{'PASS' if ok else 'FAIL'} {name}")
print(f"\n{sum(ok for _, ok in checks)}/{len(checks)} static checks passed")
if not all(ok for _, ok in checks):
    sys.exit(1)
print("LIMIT: static string checks only; SQL parsing and PostgreSQL runtime behavior NOT TESTED.")
