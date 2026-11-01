# CivicLens — DTU SEVA 2026 draft content

**Team:** kaaliFortuner  
**Lead:** Aadvik Krishna  
**Institution:** Galgotias University  
**Track:** Local, REG-004 City & Urban Problems  
**Category:** Diploma & Higher Education  
**Pilot scope:** Greater Noida, Uttar Pradesh  
**Prototype status:** Code in progress; hosted workflow and field evaluation NOT TESTED.

> **Official template:** Not present in the repository at this time. Import the official Screen-1/Screen-2 presentation template before final slide formatting. Text below is draft content, not a claim that the portal requirements have been independently reverified.

## Screen-1 — 12 dossier sections

1. **Problem statement (draft):** Residents may have difficulty documenting visible civic cleanliness issues, preparing actionable reports, and knowing whether a reported cleanup appears to have improved the site. We will validate this problem through local observation and resident interviews rather than assume prevalence.
2. **Where observed:** Greater Noida, Uttar Pradesh — pilot area proposed; specific locations and dates **TO BE COLLECTED**.
3. **Evidence:** Original and after-photo pairs, consent/collection notes, and timestamps **TO BE COLLECTED**. Do not use invented reports or photos as field evidence.
4. **Affected people and scale:** **TO BE COLLECTED** through a documented sampling method and resident interviews. No prevalence estimate is currently verified.
5. **User interaction evidence:** Interview notes, task observations, and participant counts **TO BE COLLECTED**.
6. **Existing solutions and gaps:** Existing complaint channels may capture an initial complaint but may not offer a consistent, versioned before/after evidence review and linked recurrence record in one prototype workflow. Validate this through current channel research before presenting as a confirmed gap.
7. **Proposed solution and novelty claim:** CivicLens adds “Check the Fix”: AI-assisted comparison of before/after garbage-cleanup images, reviewer-controlled action evidence, original-reporter confirmation/dispute, reasoned reviewer closure, and human-confirmed recurrence links. Position as a scoped contribution; do not claim global uniqueness.
8. **Concept diagram:** Resident submits garbage photo + location → private report storage → reviewer verifies/requests evidence → reviewer adds after-photo → optional vision model provides one of three advisory outcomes → original reporter confirms/disputes → reviewer verifies/reopens → possible nearby recurrence suggested and human-confirmed.
9. **Approximate cost and expected benefit:** Prototype cost is not yet fully measured. Software can use existing React/Vite and Supabase components; paid vision API and hosting prices **TO BE VERIFIED** on the date of submission. Expected benefit is a more structured evidence review trail; reduced municipal resolution time is an untested hypothesis, not a demonstrated outcome.
10. **75-day plan:** Days 1–10 foundation/security; 11–20 staging persistence and authentication; 21–30 evidence versioning and private storage; 31–40 Check the Fix UI and reviewer transitions; 41–50 vision endpoint and abstention tests if approved; 51–60 recurrence rules and permission tests; 61–68 supervised user testing and independent image labels; 69–75 fix issues, evidence collection, rehearsal and handover. This is a future plan, not completed progress.
11. **Team roles:** Aadvik Krishna — team lead/product coordination (confirm). Development, testing, field research, documentation, and pitch roles by team member: **TO BE CONFIRMED**.
12. **Resources and entry TRL:** Current source prototype and local development environment. Hosted workflow and user testing remain unverified. Entry TRL must be assessed against the official criteria; proposed estimate **TO BE CONFIRMED**, not asserted.

## Screen-2 — 9 technical sections

1. **Technical explanation:** React + TypeScript + Vite frontend; Supabase Auth and PostgreSQL; Row Level Security; restricted security-definer functions with empty search path; private Storage bucket; optional authenticated Supabase Edge Function calling a server-side vision API. Only garbage reports use Check the Fix.
2. **Actual prototype/demo status:** Code and migration drafts exist. Build/tests and hosted workflow must be verified before live-demo claims. The old Claude-hosted app and its reports/tests are separate and are not evidence for this repository.
3. **Architecture/design drawing:** See `ARCHITECTURE.md` in this folder.
4. **Calculations/test results:** Distance-based recurrence rule uses Haversine distance with a default 150 m radius and 90-day lookback; same category, data class, prior verified status, and human decision required. This is proximity matching, not semantic AI. Automated and hosted test results **NOT TESTED until executed**.
5. **Software BOM and costs:** React, TypeScript, Vite, Supabase Auth/PostgreSQL/Storage/Edge Functions, optional vision API, Git, and hosting provider. Exact current prices and usage assumptions **TO BE VERIFIED**. No paid AI call should be enabled without approval.
6. **Responsibilities:** Lead/product and coordination: Aadvik Krishna (supplied); named developers, QA/field researchers, and pitch owners **TO BE CONFIRMED**.
7. **Milestone progress:** Repository foundation and Check the Fix implementation drafted. SQL execution, npm build, unit tests, hosted API, live browser, and field evaluation **NOT TESTED**. Update this section only from captured evidence.
8. **Technical gaps:** No verified hosted database yet; vision key/model configuration and approval needed; model evaluation dataset absent; field evidence absent; recurrence can be wrong with inaccurate coordinates; browser workflow not yet validated.
9. **Risks and mitigations:** AI false positives/abstentions (human decision and no auto-close); privacy (private bucket, short-lived signed URLs); privilege escalation (server-side role checks); stale assessments (bind to evidence ID and before-photo path); recurrence false positives (transparent radius/time rules, reviewer decision, never merge); cost (AI disabled unless explicitly enabled); unsupported municipal integration (label as internal workflow only).

## Five-minute pitch script (draft; do not state unverified results)

**0:00–0:35 — Problem.** “A civic cleanliness report is only the beginning. The next question is whether the visible problem appears to have changed, what evidence supports that judgement, and whether the issue returns. Our first step is to validate how often residents face this gap in Greater Noida.”

**0:35–1:10 — Solution.** “CivicLens is a scoped civic-reporting prototype. Our differentiator is Check the Fix: the original garbage photo stays unchanged, a reviewer records an after-photo and action note, and the two images are reviewed side by side.”

**1:10–2:00 — Demo flow.** Show resident submission, private photo upload, report ID, reviewer queue, and explicit status transition. Use test data only. Say “internal report” rather than “official complaint submitted.”

**2:00–2:50 — AI and human safeguards.** “A server-side vision model can return possible improvement, problem may remain, or cannot assess. Unrelated or obstructed images should abstain. The output is advisory only: it cannot prove authenticity, official action, or physical resolution. The original reporter can confirm or dispute, and only an authorized reviewer can verify closure.”

**2:50–3:35 — Recurrence.** “A transparent proximity rule can suggest a new garbage report near an earlier verified one. A human confirms or rejects the link. Each incident retains its own ID; nearby does not automatically mean duplicate.”

**3:35–4:20 — Evaluation plan.** “We will evaluate independently labelled image pairs, report abstentions and errors, test permissions with two residents and one reviewer, and document the limits of coordinates and image metadata. We will not claim accuracy until we have measured it.”

**4:20–5:00 — Scope and ask.** “Our contribution is AI-assisted review of visible cleanup evidence, human confirmation, and recurrence tracking for a scoped Greater Noida pilot. Current hosted tests and field results will be presented only when verified. We seek feedback on the workflow and a controlled opportunity to evaluate it with residents.”

## Recording checklist

- Maximum duration: 5 minutes; record actual duration before submission.
- Show only synthetic/test reports unless participants explicitly consented to real evidence use.
- Verify no API keys, email addresses, passwords, or signed URLs remain visible.
- Demonstrate an abstention/manual fallback if AI is unavailable; never simulate it as a real model result.
- Show one successful and one rejected permission action only after those tests actually pass.
- Mention the date and environment for each test result; disclose anything not tested.
- Verify the video URL is viewable by intended evaluators before submission.

## BOM placeholders

| Item | Current selection | Price/status |
|---|---|---|
| Frontend framework | React + TypeScript + Vite | Open-source; verify hosting costs separately |
| Authentication/database/storage | Supabase | Plan and current limits **TO BE VERIFIED** |
| Vision endpoint | Supabase Edge Function + provider API | Disabled by default; usage pricing **TO BE VERIFIED** |
| Frontend hosting | To be selected | **TO BE VERIFIED** |
| Field evaluation | Small consent-based test | Sample size and costs **TO BE COLLECTED** |
