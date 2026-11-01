import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { AlertTriangle, Camera, CheckCircle2, Clock3, RefreshCw, ShieldCheck, UploadCloud } from 'lucide-react';
import { PHOTO_BUCKET, supabase } from './lib';
import type { CivicReport } from './lib';
import { CHECK_FIX_OUTCOME_LABELS, CHECK_FIX_STATUS_LABELS, canReviewerTransition, isCurrentAssessment, validateCheckFixPhoto } from './checkFix';
import type { CheckFixStatus, CheckFixOutcome } from './checkFix';

type Role = 'resident' | 'reviewer' | 'viewer';
type Evidence = { id: string; report_id: string; actor_id: string; object_path: string; action_note: string; uploaded_at: string; captured_at: string | null; content_type: string; byte_size: number };
type Assessment = { id: string; report_id: string; evidence_id: string; before_object_path: string; comparable: boolean; outcome: CheckFixOutcome; rationale: string; provider: string | null; model: string | null; created_by: string; created_at: string };
type ResponseRow = { id: string; response: 'confirm_improvement' | 'dispute'; note: string; actor_id: string; created_at: string };
type Candidate = { prior_report_id: string; prior_created_at: string; prior_location_label: string; distance_m: number; reason: string };
type RecurrenceLink = { id: string; new_report_id: string; prior_report_id: string; decision: 'confirmed' | 'rejected'; decision_note: string; actor_id: string; decided_at: string };
type RelatedReport = { id: string; description: string; location_label: string; created_at: string; internal_status: string };
type WorkflowHistory = { id: number; actor_id: string; actor_role: 'resident' | 'reviewer' | 'system' | null; internal_status_old: CheckFixStatus | null; internal_status_new: CheckFixStatus | null; note: string; created_at: string };

const statusFromReport = (report: CivicReport): string => report.internal_status;

const checkFixStatusLabel = (status: string): string =>
  status in CHECK_FIX_STATUS_LABELS
    ? CHECK_FIX_STATUS_LABELS[status as CheckFixStatus]
    : status;

export default function CheckFixPanel({ report, role, userId, beforeUrl, onChanged }: {
  report: CivicReport; role: Role; userId: string; beforeUrl?: string; onChanged: () => void;
}) {
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [evidenceUrls, setEvidenceUrls] = useState<Record<string, string>>({});
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [responses, setResponses] = useState<ResponseRow[]>([]);
  const [workflowHistory, setWorkflowHistory] = useState<WorkflowHistory[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [links, setLinks] = useState<RecurrenceLink[]>([]);
  const [related, setRelated] = useState<Record<string, RelatedReport>>({});
  const [file, setFile] = useState<File | null>(null);
  const [actionNote, setActionNote] = useState('');
  const [capturedAt, setCapturedAt] = useState('');
  const [humanNote, setHumanNote] = useState('');
  const [transitionReason, setTransitionReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [assessmentError, setAssessmentError] = useState('');
  const [photoError, setPhotoError] = useState('');

  const currentStatus = statusFromReport(report);
  const latestEvidence = evidence[0] ?? null;
  const latestAssessment = assessments.find(a => isCurrentAssessment(a, latestEvidence?.id ?? null, report.photo_object_path)) ?? null;
  const priorAssessments = useMemo(() => assessments.filter(a => a.id !== latestAssessment?.id), [assessments, latestAssessment]);
  const latestResponse = responses[0] ?? null;

  const load = useCallback(async () => {
    if (!supabase) return;
    setError('');
    const [evidenceResult, assessmentResult, responseResult, historyResult] = await Promise.all([
      supabase.from('report_evidence').select('id,report_id,actor_id,object_path,action_note,uploaded_at,captured_at,content_type,byte_size').eq('report_id', report.id).order('uploaded_at', { ascending: false }).order('id', { ascending: false }),
      supabase.from('check_fix_assessments').select('id,report_id,evidence_id,before_object_path,comparable,outcome,rationale,provider,model,created_by,created_at').eq('report_id', report.id).order('created_at', { ascending: false }),
      supabase.from('check_fix_responses').select('id,response,note,actor_id,created_at').eq('report_id', report.id).order('created_at', { ascending: false }),
      supabase.from('report_history').select('id,actor_id,actor_role,internal_status_old,internal_status_new,note,created_at').eq('report_id', report.id).order('created_at', { ascending: false }),
    ]);
    if (evidenceResult.error) setError(`Evidence could not load: ${evidenceResult.error.message}`);
    else setEvidence((evidenceResult.data ?? []) as Evidence[]);
    if (assessmentResult.error) setError(`Assessment history could not load: ${assessmentResult.error.message}`);
    else setAssessments((assessmentResult.data ?? []) as Assessment[]);
    if (responseResult.error) setError(`Reporter responses could not load: ${responseResult.error.message}`);
    else setResponses((responseResult.data ?? []) as ResponseRow[]);
    if (historyResult.error) setError(`Workflow history could not load: ${historyResult.error.message}`);
    else setWorkflowHistory((historyResult.data ?? []) as WorkflowHistory[]);

    if (role === 'reviewer') {
      const { data: candidateData, error: candidateError } = await supabase.rpc('find_garbage_recurrence_candidates', { p_new_report_id: report.id, p_radius_m: 150, p_lookback_days: 90 });
      if (candidateError) setError(`Recurrence suggestions unavailable: ${candidateError.message}`);
      else setCandidates((candidateData ?? []) as Candidate[]);
      const { data: linkData, error: linkError } = await supabase.from('garbage_recurrence_decisions').select('id,new_report_id,prior_report_id,decision,decision_note,actor_id,decided_at').or(`new_report_id.eq.${report.id},prior_report_id.eq.${report.id}`).order('decided_at', { ascending: false });
      if (linkError) setError(`Recurrence timeline unavailable: ${linkError.message}`);
      else {
        const allLinks = (linkData ?? []) as RecurrenceLink[];
        setLinks(allLinks);
        const ids = [...new Set(allLinks.map(link => link.new_report_id === report.id ? link.prior_report_id : link.new_report_id))];
        if (ids.length) {
          const { data: relatedRows } = await supabase.from('reports').select('id,description,location_label,created_at,internal_status').in('id', ids);
          setRelated(Object.fromEntries(((relatedRows ?? []) as RelatedReport[]).map(row => [row.id, row])));
        } else setRelated({});
      }
    }
  }, [report.id, report.photo_object_path, report.internal_status, role]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!supabase || evidence.length === 0) { setEvidenceUrls({}); return; }
    let cancelled = false;
    void Promise.all(evidence.map(async item => {
      const { data, error: signedError } = await supabase!.storage.from(PHOTO_BUCKET).createSignedUrl(item.object_path, 180);
      return signedError || !data ? null : [item.id, data.signedUrl] as const;
    })).then(pairs => {
      if (!cancelled) setEvidenceUrls(Object.fromEntries(pairs.filter(Boolean) as (readonly [string, string])[]));
    });
    return () => { cancelled = true; };
  }, [evidence]);

  async function runTransition(next: CheckFixStatus) {
    if (!supabase || !transitionReason.trim()) { setError('Add a reason for this status change.'); return; }
    setBusy(true); setError(''); setNotice('');
    const { error: rpcError } = await supabase.rpc('transition_check_fix', { p_report_id: report.id, p_to_status: next, p_reason: transitionReason.trim() });
    setBusy(false);
    if (rpcError) { setError(`Status change rejected: ${rpcError.message}`); return; }
    setNotice(`Status changed to ${CHECK_FIX_STATUS_LABELS[next]}.`); setTransitionReason(''); onChanged(); await load();
  }

  async function uploadAfterPhoto(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !file) { setPhotoError('Choose an after-photo first.'); return; }
    const validation = validateCheckFixPhoto(file);
    if (validation) { setPhotoError(validation); return; }
    if (!actionNote.trim()) { setPhotoError('Add a factual action note.'); return; }
    setBusy(true); setError(''); setPhotoError(''); setNotice('');
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${userId}/check-fix/${report.id}/${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) { setBusy(false); setError(`Private photo upload failed: ${uploadError.message}`); return; }
    const { error: registerError } = await supabase.rpc('register_check_fix_evidence', {
      p_report_id: report.id, p_object_path: path, p_action_note: actionNote.trim(),
      p_captured_at: capturedAt ? new Date(capturedAt).toISOString() : null,
      p_content_type: file.type, p_byte_size: file.size,
    });
    if (registerError) {
      // Preserve the private object after an ambiguous network result; do not risk deleting committed evidence.
      setBusy(false); setError(`Evidence registration failed: ${registerError.message}. Refresh before retrying; an unused private object may need admin cleanup.`); return;
    }
    setBusy(false); setFile(null); setActionNote(''); setCapturedAt(''); setNotice('After-photo saved. Earlier AI assessments are retained as history but are no longer current.'); onChanged(); await load();
  }

  async function runAiAssessment() {
    if (!supabase || !latestEvidence) return;
    const ok = window.confirm('This sends the selected before/after photos to the configured vision API. API usage may incur charges if enabled by the project administrator. Continue?');
    if (!ok) return;
    setBusy(true); setError(''); setAssessmentError(''); setNotice('');
    const { data, error: invokeError } = await supabase.functions.invoke('check-fix-assess', { body: { reportId: report.id, evidenceId: latestEvidence.id } });
    setBusy(false);
    if (invokeError || data?.error) { setAssessmentError(data?.error || invokeError?.message || 'AI unavailable. Use manual review.'); return; }
    setNotice('AI assessment saved against the current evidence version. Human review is still required.'); await load();
  }

  async function submitReporterResponse(response: 'confirm_improvement' | 'dispute') {
    if (!supabase) return;
    setBusy(true); setError(''); setNotice('');
    const { error: rpcError } = await supabase.rpc('respond_check_fix', { p_report_id: report.id, p_response: response, p_note: humanNote.trim() });
    setBusy(false);
    if (rpcError) { setError(`Response rejected: ${rpcError.message}`); return; }
    setNotice(response === 'dispute' ? 'Dispute recorded; the report was reopened for another review.' : 'Your confirmation was recorded. An authorized reviewer still decides whether to verify closure.'); setHumanNote(''); onChanged(); await load();
  }

  async function decideRecurrence(candidate: Candidate, decision: 'confirmed' | 'rejected') {
    if (!supabase) return;
    const note = window.prompt(`Optional note for ${decision} recurrence link (same category, within 150 m, prior verified report within 90 days):`) ?? '';
    setBusy(true); setError('');
    const { error: rpcError } = await supabase.rpc('decide_garbage_recurrence', { p_new_report_id: report.id, p_prior_report_id: candidate.prior_report_id, p_decision: decision, p_note: note, p_radius_m: 150, p_lookback_days: 90 });
    setBusy(false);
    if (rpcError) { setError(`Recurrence decision rejected: ${rpcError.message}`); return; }
    setNotice(`Recurrence link ${decision}. The new report remains a separate incident.`); await load();
  }

  if (report.category !== 'Garbage dump') return null;

  const transitionChoices: CheckFixStatus[] = (['under_review', 'needs_more_evidence', 'reopened'] as CheckFixStatus[]).filter(next => canReviewerTransition(currentStatus, next));
  if (currentStatus === 'reopened' || currentStatus === 'needs_more_evidence') {
    if (canReviewerTransition(currentStatus, 'under_review') && !transitionChoices.includes('under_review')) transitionChoices.push('under_review');
  }

  return <section className="check-fix-panel" aria-labelledby={`checkfix-${report.id}`}>
    <div className="check-fix-heading"><div><span className="step-label">CHECK THE FIX</span><h4 id={`checkfix-${report.id}`}>Cleanup evidence review</h4></div><span className={`status-chip status-${currentStatus}`}>{checkFixStatusLabel(currentStatus)}</span></div>
    <p className="helper-text">Compare the original issue photo with the latest action photo. Use a similar viewpoint, distance, direction, and framing where possible. Upload time is server recorded; capture time is optional self-reported metadata. Neither GPS nor image metadata proves authenticity.</p>
    <div className="before-after-grid">
      <figure><figcaption>Before · original report photo</figcaption>{beforeUrl ? <a href={beforeUrl} target="_blank" rel="noreferrer"><img src={beforeUrl} alt="Original garbage issue photo" loading="lazy" /></a> : <div className="photo-placeholder">Original private photo unavailable</div>}</figure>
      <figure><figcaption>After · latest submitted evidence</figcaption>{latestEvidence && evidenceUrls[latestEvidence.id] ? <a href={evidenceUrls[latestEvidence.id]} target="_blank" rel="noreferrer"><img src={evidenceUrls[latestEvidence.id]} alt="Latest after-cleanup evidence" loading="lazy" /></a> : <div className="photo-placeholder">No after-photo uploaded</div>}</figure>
    </div>
    {latestEvidence && <div className="evidence-meta"><Clock3 size={14} /><span>Uploaded: {new Date(latestEvidence.uploaded_at).toLocaleString()}</span><span>By: reviewer account</span>{latestEvidence.captured_at && <span>Capture time (unverified): {new Date(latestEvidence.captured_at).toLocaleString()}</span>}<p>{latestEvidence.action_note}</p></div>}
    {role === 'reviewer' && (currentStatus === 'under_review' || currentStatus === 'needs_more_evidence') && <form className="check-fix-upload" onSubmit={uploadAfterPhoto}>
      <h5><Camera size={16} /> Record cleanup action</h5>
      <label className="field-label">After-photo · JPG, PNG, WebP · maximum 5 MB</label>
      <label className="upload-box compact-upload"><UploadCloud size={20} /><strong>{file?.name ?? 'Choose after-photo'}</strong><span>Stored in the private bucket; prior evidence is preserved.</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { const next = e.target.files?.[0] ?? null; setFile(next); setPhotoError(next ? validateCheckFixPhoto(next) ?? '' : ''); }} /></label>
      <label className="field-label">Action note</label><textarea value={actionNote} onChange={e => setActionNote(e.target.value)} rows={2} maxLength={1200} placeholder="Describe the visible action reported; do not claim proof of official action." />
      <label className="field-label">Photo capture time (optional; not verified)</label><input type="datetime-local" value={capturedAt} onChange={e => setCapturedAt(e.target.value)} />
      {photoError && <p className="error-text">{photoError}</p>}
      <button className="primary-btn" disabled={busy || !file || !actionNote.trim()}>Upload after-photo & record action</button>
    </form>}
    <div className="ai-review-box"><div className="ai-review-title"><ShieldCheck size={17} /><strong>AI-assisted assessment</strong><span className="demo-tag">ADVISORY ONLY</span></div>
      {latestAssessment ? <div className="assessment-result"><b>{CHECK_FIX_OUTCOME_LABELS[latestAssessment.outcome]}</b><p>{latestAssessment.rationale}</p><small>{latestAssessment.comparable ? 'Images marked comparable by the model' : 'Model could not establish comparability'} · {latestAssessment.provider || 'Provider not recorded'}{latestAssessment.model ? ` / ${latestAssessment.model}` : ''} · {new Date(latestAssessment.created_at).toLocaleString()}</small><p className="helper-text">This is not proof of cleanup, authenticity, or official action. A human must decide the next step.</p></div> : <p className="helper-text">No current AI assessment for the latest before/after pair. Manual human review remains available.</p>}
      {role === 'reviewer' && latestEvidence && <button className="secondary-btn" disabled={busy} onClick={() => void runAiAssessment()}><RefreshCw size={14} /> {busy ? 'Assessing…' : 'Assess latest photo pair with vision AI'}</button>}
      {assessmentError && <div className="error-box">{assessmentError}<p className="helper-text">No keyword-based substitute is used. Continue with human review.</p></div>}
      {priorAssessments.length > 0 && <details><summary>Earlier assessments ({priorAssessments.length}) — historical only</summary><ul>{priorAssessments.map(a => <li key={a.id}><b>{CHECK_FIX_OUTCOME_LABELS[a.outcome]}</b> · {new Date(a.created_at).toLocaleString()} <span className="muted">(not current for latest evidence)</span></li>)}</ul></details>}
    </div>
    {role === 'reviewer' && <div className="review-controls check-fix-controls">
      {transitionChoices.length > 0 && <><label className="field-label">Reason for status transition</label><input value={transitionReason} onChange={e => setTransitionReason(e.target.value)} maxLength={1200} placeholder="Required audit reason" />{transitionChoices.map(next => <button key={next} className="secondary-btn" disabled={busy || !transitionReason.trim()} onClick={() => void runTransition(next)}>{CHECK_FIX_STATUS_LABELS[next]}</button>)}</>}
      {currentStatus === 'action_reported' && <><label className="field-label">Verification reason (required)</label><input value={transitionReason} onChange={e => setTransitionReason(e.target.value)} maxLength={1200} placeholder="What visible evidence supports closure?" /><button className="primary-btn" disabled={busy || !transitionReason.trim()} onClick={() => void runTransition('resolution_verified')}><CheckCircle2 size={15} /> Verify resolution</button></>}
    </div>}
    {report.reporter_id === userId && ['action_reported', 'resolution_verified'].includes(currentStatus) && <div className="reporter-confirm-box"><h5>Did the visible situation improve?</h5><p className="helper-text">Your response is recorded under your resident account. Confirming does not grant reviewer permissions or automatically close the report.</p><textarea value={humanNote} onChange={e => setHumanNote(e.target.value)} rows={2} maxLength={1200} placeholder="Optional explanation" /><div className="button-row"><button className="secondary-btn" disabled={busy} onClick={() => void submitReporterResponse('confirm_improvement')}>Confirm improvement</button><button className="secondary-btn dispute-btn" disabled={busy} onClick={() => void submitReporterResponse('dispute')}>Dispute / reopen</button></div>{latestResponse && <p className="helper-text">Latest response: <b>{latestResponse.response === 'dispute' ? 'Disputed' : 'Confirmed improvement'}</b> · Original reporter · {new Date(latestResponse.created_at).toLocaleString()}</p>}</div>}
    <div className="workflow-history-box"><h5>Review and confirmation history</h5>{workflowHistory.length ? <ol className="history-list">{workflowHistory.map(event => <li key={event.id}><b>{event.internal_status_old && event.internal_status_new ? `${CHECK_FIX_STATUS_LABELS[event.internal_status_old] ?? event.internal_status_old} → ${CHECK_FIX_STATUS_LABELS[event.internal_status_new] ?? event.internal_status_new}` : 'Report event'}</b><span>{new Date(event.created_at).toLocaleString()} · {event.actor_role === 'reviewer' ? 'Authorized reviewer' : event.actor_role === 'resident' ? (event.actor_id === report.reporter_id ? 'Original reporter' : 'Resident account') : 'Actor role not recorded'}</span>{event.note && <p>{event.note}</p>}<small>Actor ID: {event.actor_id}</small></li>)}</ol> : <p className="helper-text">No workflow history visible yet.</p>}</div>
    {role === 'reviewer' && <div className="recurrence-box"><h5>Possible recurrence · proximity rule, not AI</h5><p className="helper-text">Candidates use garbage category, same data class, a prior reviewer-verified report within 150 metres, and a 90-day lookback. Inaccurate coordinates and nearby unrelated issues can produce false suggestions. Human decision required; reports are never merged.</p>
      {candidates.filter(c => !links.some(l => l.new_report_id === report.id && l.prior_report_id === c.prior_report_id)).map(candidate => <article className="recurrence-candidate" key={candidate.prior_report_id}><div><b>{candidate.prior_location_label || 'Earlier reported location'}</b><p>{Math.round(candidate.distance_m)} m away · {new Date(candidate.prior_created_at).toLocaleDateString()}</p><small>{candidate.reason}</small><small>Prior report ID: {candidate.prior_report_id}</small></div><div className="button-row"><button className="secondary-btn" disabled={busy} onClick={() => void decideRecurrence(candidate, 'confirmed')}>Confirm link</button><button className="secondary-btn" disabled={busy} onClick={() => void decideRecurrence(candidate, 'rejected')}>Reject</button></div></article>)}
      {links.length > 0 && <><h5>Linked incident timeline</h5><ol className="history-list">{links.map(link => { const otherId = link.new_report_id === report.id ? link.prior_report_id : link.new_report_id; const other = related[otherId]; return <li key={link.id}><b>{link.decision === 'confirmed' ? 'Confirmed recurrence link' : 'Rejected recurrence suggestion'}</b><span>{new Date(link.decided_at).toLocaleString()} · Reviewer decision</span><p>{other ? `${other.description} — ${other.location_label} (${CHECK_FIX_STATUS_LABELS[other.internal_status as CheckFixStatus] ?? other.internal_status})` : `Related report ${otherId}`}</p><small>Report ID: {otherId} · Current report remains separate.</small></li>; })}</ol></>}
      {candidates.length === 0 && links.length === 0 && <p className="helper-text">No candidate matched the configured rule. This is not proof that recurrence did not happen.</p>}
    </div>}
    {error && <div className="error-box">{error}</div>}{notice && <div className="inline-notice">{notice}</div>}
    <div className="check-fix-footnote"><AlertTriangle size={14} /><span>AI and location rules assist review only. They do not prove authenticity, municipal action, or physical resolution.</span></div>
  </section>;
}
