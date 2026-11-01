import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import CheckFixPanel from './CheckFixPanel';
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, FileText, LogOut, MapPin, RefreshCw, ShieldCheck, UploadCloud } from 'lucide-react';
import { CATEGORIES, INTERNAL_STATUSES, MAX_PHOTO_BYTES, PHOTO_BUCKET, STATUS_LABELS, isSupabaseConfigured, makeComplaint, makeReportFingerprint, supabase, validatePhoto } from './lib';
import type { CivicReport, InternalStatus, IssueCategory, ReportHistory } from './lib';

type Tab = 'new' | 'reports' | 'reviewer';
type Role = 'resident' | 'reviewer' | 'viewer';
const blankComplaint = '';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('resident');
  const [tab, setTab] = useState<Tab>('new');
  const [reports, setReports] = useState<CivicReport[]>([]);
  const [reviewReports, setReviewReports] = useState<CivicReport[]>([]);
  const [historyById, setHistoryById] = useState<Record<string, ReportHistory[]>>({});
  const [category, setCategory] = useState<IssueCategory>('Garbage dump');
  const [description, setDescription] = useState('');
  const [locationLabel, setLocationLabel] = useState('Greater Noida, Uttar Pradesh');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [locationConfirmed, setLocationConfirmed] = useState(false);
  const [language, setLanguage] = useState<'English' | 'Hindi'>('English');
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoError, setPhotoError] = useState('');
  const [complaint, setComplaint] = useState(blankComplaint);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [statusDrafts, setStatusDrafts] = useState<Record<string, InternalStatus>>({});
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [idempotencyFingerprint, setIdempotencyFingerprint] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return; }
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError) setError(sessionError.message);
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setError('');
    });
    return () => subscription.unsubscribe();
  }, []);

  const complaintDraft = useMemo(() => makeComplaint(category, description, locationLabel, language), [category, description, locationLabel, language]);

  const loadRole = useCallback(async () => {
    if (!supabase || !session) return;
    const { data, error: roleError } = await supabase.rpc('get_my_role');
    if (roleError) { setError(`Could not load account role: ${roleError.message}`); return; }
    const assigned = (data || 'resident') as Role;
    setRole(assigned);
    if (assigned === 'reviewer') setTab('reviewer');
    else if (tab === 'reviewer') setTab('reports');
  }, [session, tab]);

  const loadResidentReports = useCallback(async () => {
    if (!supabase || !session) return;
    const { data, error: reportsError } = await supabase.from('reports')
      .select('id,reporter_id,category,description,complaint_text,complaint_language,location_label,latitude,longitude,location_accuracy_m,photo_object_path,internal_status,data_class,created_at,updated_at')
      .order('created_at', { ascending: false });
    if (reportsError) { setError(`Could not load your reports: ${reportsError.message}`); return; }
    const rows = (data || []) as CivicReport[];
    setReports(rows);
    if (rows.length) {
      const { data: history, error: historyError } = await supabase.from('report_history')
        .select('id,report_id,actor_id,actor_role,internal_status_old,internal_status_new,note,created_at')
        .in('report_id', rows.map(r => r.id)).order('created_at', { ascending: true });
      if (historyError) setError(`Reports loaded, but history failed: ${historyError.message}`);
      else {
        const grouped: Record<string, ReportHistory[]> = {};
        (history || []).forEach((entry: ReportHistory) => { (grouped[entry.report_id] ||= []).push(entry); });
        setHistoryById(prev => ({ ...prev, ...grouped }));
      }
      await createPhotoUrls(rows);
    } else { setHistoryById({}); }
  }, [session]);

  const loadReviewerReports = useCallback(async () => {
    if (!supabase || !session || role !== 'reviewer') return;
    const { data, error: reportsError } = await supabase.from('reports')
      .select('id,reporter_id,category,description,complaint_text,complaint_language,location_label,latitude,longitude,location_accuracy_m,photo_object_path,internal_status,data_class,created_at,updated_at')
      .order('created_at', { ascending: false });
    if (reportsError) { setError(`Could not load review queue: ${reportsError.message}`); return; }
    const rows = (data || []) as CivicReport[];
    setReviewReports(rows);
    await createPhotoUrls(rows);
  }, [session, role]);

  async function createPhotoUrls(rows: CivicReport[]) {
    if (!supabase) return;
    const pairs = await Promise.all(rows.filter(r => r.photo_object_path).map(async r => {
      const { data, error: urlError } = await supabase!.storage.from(PHOTO_BUCKET).createSignedUrl(r.photo_object_path, 180);
      return urlError || !data ? null : [r.id, data.signedUrl] as const;
    }));
    setPhotoUrls(prev => ({ ...prev, ...Object.fromEntries(pairs.filter(Boolean) as (readonly [string, string])[]) }));
  }

  useEffect(() => { if (session) void loadRole(); }, [session, loadRole]);
  useEffect(() => { if (session) void loadResidentReports(); }, [session, loadResidentReports]);
  useEffect(() => { if (session && role === 'reviewer') void loadReviewerReports(); }, [session, role, loadReviewerReports]);

  async function handleAuth(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true); setError(''); setNotice('');
    const result = authMode === 'signin'
      ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
      : await supabase.auth.signUp({ email: email.trim(), password });
    setBusy(false);
    if (result.error) { setError(result.error.message); return; }
    if (authMode === 'signup' && !result.data.session) setNotice('Account created. Check your email to confirm the address, then sign in.');
    else setNotice(authMode === 'signup' ? 'Account created and signed in.' : 'Signed in successfully.');
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setReports([]); setReviewReports([]); setHistoryById({}); setPhotoUrls({}); setRole('resident'); setTab('new');
  }

  function useLocation() {
    setError(''); setNotice(''); setLocationConfirmed(false);
    if (!navigator.geolocation) { setError('This browser does not support GPS. Enter coordinates manually.'); return; }
    navigator.geolocation.getCurrentPosition(pos => {
      setLatitude(pos.coords.latitude.toFixed(6)); setLongitude(pos.coords.longitude.toFixed(6));
      setAccuracy(Math.round(pos.coords.accuracy)); setLocationConfirmed(false);
      setNotice(`GPS captured (accuracy ±${Math.round(pos.coords.accuracy)} m). Review and confirm the coordinates.`);
    }, () => setError('GPS permission failed. Allow location access or enter coordinates manually.'), { enableHighAccuracy: true, timeout: 12000 });
  }

  function confirmCoordinates() {
    const lat = Number(latitude), lon = Number(longitude);
    if (!latitude.trim() || !longitude.trim() || !Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      setError('Enter valid coordinates: latitude −90 to 90 and longitude −180 to 180.'); setLocationConfirmed(false); return;
    }
    setLatitude(String(lat)); setLongitude(String(lon)); setLocationConfirmed(true); setError(''); setNotice('Coordinates confirmed.');
  }

  function selectPhoto(file?: File) {
    setPhotoError('');
    if (!file) { setPhoto(null); return; }
    const invalid = validatePhoto(file);
    if (invalid) { setPhoto(null); setPhotoError(invalid); return; }
    setPhoto(file);
  }

  async function submitReport(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !session?.user) return;
    setError(''); setNotice('');
    if (!description.trim()) { setError('Add a description of what you observed.'); return; }
    if (!photo) { setError('Choose a photograph before submitting.'); return; }
    if (!locationConfirmed) { setError('Confirm your coordinates before submitting.'); return; }
    const lat = Number(latitude), lon = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) { setError('Coordinates are invalid.'); return; }
    if (photo.size > MAX_PHOTO_BYTES) { setError('Photo exceeds the 5 MB limit.'); return; }
    const fingerprint = makeReportFingerprint({
      category, description: description.trim(), complaintText: complaint.trim() || complaintDraft,
      complaintLanguage: language, locationLabel: locationLabel.trim(), latitude: lat, longitude: lon,
      accuracy, photoName: photo.name, photoSize: photo.size, photoLastModified: photo.lastModified, photoType: photo.type,
    });
    const activeIdempotencyKey = idempotencyFingerprint === null || idempotencyFingerprint === fingerprint
      ? idempotencyKey
      : crypto.randomUUID();
    setIdempotencyFingerprint(fingerprint);
    if (activeIdempotencyKey !== idempotencyKey) setIdempotencyKey(activeIdempotencyKey);
    setBusy(true);
    const reportId = crypto.randomUUID();
    const extension = photo.type === 'image/png' ? 'png' : photo.type === 'image/webp' ? 'webp' : 'jpg';
    const objectPath = `${session.user.id}/${reportId}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from(PHOTO_BUCKET).upload(objectPath, photo, { contentType: photo.type, upsert: false });
    if (uploadError) { setBusy(false); setError(`Photo upload failed: ${uploadError.message}`); return; }
    const { data, error: createError } = await supabase.rpc('create_civic_report', {
      p_id: reportId,
      p_idempotency_key: activeIdempotencyKey,
      p_category: category,
      p_description: description.trim(),
      p_complaint_text: complaint.trim() || complaintDraft,
      p_complaint_language: language,
      p_location_label: locationLabel.trim(),
      p_latitude: lat,
      p_longitude: lon,
      p_location_accuracy_m: accuracy,
      p_photo_object_path: objectPath,
    });
    if (createError) {
      // Do not delete the uploaded object on an ambiguous RPC/network failure: the DB transaction may have committed.
      // Retain the idempotency key so retrying the same submission cannot create a second report.
      setBusy(false); setError(`Report save failed: ${createError.message}. You can retry; the same submission key is retained.`); return;
    }
    const savedReportId = String(data || reportId);
    if (savedReportId !== reportId) {
      // An earlier retry already created the report; remove this attempt's unused uploaded photo.
      await supabase.storage.from(PHOTO_BUCKET).remove([objectPath]);
    }
    setBusy(false); setDescription(''); setPhoto(null); setComplaint(''); setAccuracy(null); setLocationConfirmed(false); setIdempotencyKey(crypto.randomUUID()); setIdempotencyFingerprint(null);
    setNotice(`Report saved to Supabase. Reference: ${savedReportId}`);
    setTab('reports'); await loadResidentReports();
  }

  async function updateInternalStatus(reportId: string) {
    if (!supabase) return;
    const nextStatus = statusDrafts[reportId] || 'in_review';
    setBusy(true); setError(''); setNotice('');
    const { error: updateError } = await supabase.rpc('review_civic_report', {
      p_report_id: reportId, p_internal_status: nextStatus,
      p_note: (reviewNotes[reportId] || '').trim(),
    });
    setBusy(false);
    if (updateError) { setError(`Status update rejected: ${updateError.message}`); return; }
    setNotice(`Internal status updated for ${reportId}.`);
    await Promise.all([loadReviewerReports(), loadResidentReports()]);
  }

  if (!isSupabaseConfigured || !supabase) {
    return <div className="app-shell"><header className="topbar"><div className="brand"><span className="brand-mark"><MapPin size={21} /></span><span><strong>CivicLens</strong><small>Shared civic issue reporting</small></span></div></header><main className="layout"><section className="card form-card"><h1>Supabase setup required</h1><p>The app has been switched from localStorage to Supabase-backed authentication, private photo storage, reports, and history. Add the public project URL and anon/publishable key to <code>.env</code> to enable the workflow.</p><ol><li>Create or open your Supabase project.</li><li>Copy the Project URL and anon/publishable key from Project Settings → API.</li><li>Put them in <code>.env</code> as <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>.</li><li>Run the migrations in <code>supabase/migrations</code> in order.</li></ol><p><b>Do not use a service-role key in the frontend.</b></p></section></main></div>;
  }

  if (authLoading) return <main className="layout"><p>Checking sign-in session…</p></main>;
  if (!session) return <div className="app-shell"><header className="topbar"><div className="brand"><span className="brand-mark"><MapPin size={21} /></span><span><strong>CivicLens</strong><small>See it. Report it. Track it.</small></span><span className="pilot-pill">GREATER NOIDA · PILOT</span></div></header><main className="layout auth-layout"><section className="intro"><div className="eyebrow">CIVIC ISSUES, MADE EASIER</div><h1>Small reports.<br /><em>Better neighbourhoods.</em></h1><p>Sign in to submit a report, securely upload its photograph, and track status updates from an authorized reviewer.</p></section><section className="card form-card auth-card"><div className="card-heading"><div><span className="step-label">ACCOUNT</span><h2>{authMode === 'signin' ? 'Sign in to CivicLens' : 'Create your resident account'}</h2></div><span className="icon-bubble"><ShieldCheck size={20} /></span></div><form onSubmit={handleAuth}><label className="field-label" htmlFor="email">Email</label><input id="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /><label className="field-label" htmlFor="password">Password</label><input id="password" type="password" autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'} minLength={8} required value={password} onChange={e => setPassword(e.target.value)} /><button className="primary-btn full-btn" disabled={busy}>{busy ? 'Please wait…' : authMode === 'signin' ? 'Sign in' : 'Create account'} <ArrowRight size={16} /></button></form><p className="auth-switch">{authMode === 'signin' ? 'New to CivicLens?' : 'Already registered?'} <button onClick={() => { setAuthMode(authMode === 'signin' ? 'signup' : 'signin'); setError(''); setNotice(''); }}>{authMode === 'signin' ? 'Create account' : 'Sign in'}</button></p><p className="helper-text">Reviewer access is granted by a project administrator. Signing up never grants reviewer permissions.</p>{notice && <div className="inline-notice">{notice}</div>}{error && <div className="error-box">{error}</div>}</section></main></div>;

  return <div className="app-shell"><header className="topbar"><div className="brand"><span className="brand-mark"><MapPin size={21} /></span><span><strong>CivicLens</strong><small>See it. Report it. Track it.</small></span></div><div className="header-right"><span className="account-label">{session.user.email} · {role}</span><button className="secondary-btn" onClick={signOut}><LogOut size={15} /> Sign out</button></div></header><main className="layout"><section className="intro compact-intro"><div className="eyebrow">CIVIC ISSUES, MADE EASIER</div><h1>Small reports.<br /><em>Better neighbourhoods.</em></h1><p>Submit an evidence-backed report and follow internal review progress.</p></section><div className="notice-bar"><AlertTriangle size={17} /><span><b>Prototype notice:</b> internal CivicLens status is not an official government acknowledgement or proof of resolution. Do not upload sensitive photos.</span></div>{notice && <div className="success-banner"><CheckCircle2 size={17} />{notice}</div>}{error && <div className="error-box">{error}</div>}<nav className="tabs"><button className={tab === 'new' ? 'tab active' : 'tab'} onClick={() => setTab('new')}>New report</button><button className={tab === 'reports' ? 'tab active' : 'tab'} onClick={() => setTab('reports')}>My reports <span className="count">{reports.length}</span></button>{role === 'reviewer' && <button className={tab === 'reviewer' ? 'tab active' : 'tab'} onClick={() => setTab('reviewer')}>Reviewer queue <span className="count">{reviewReports.length}</span></button>}<button className="tab refresh-tab" onClick={() => { void loadResidentReports(); if (role === 'reviewer') void loadReviewerReports(); }}><RefreshCw size={14} /> Refresh</button></nav>
    {tab === 'new' && <form className="card form-card" onSubmit={submitReport}><div className="card-heading"><div><span className="step-label">STEP 01</span><h2>Describe the issue</h2></div><span className="icon-bubble"><MapPin size={20} /></span></div><label className="field-label">Issue category</label><div className="category-grid">{CATEGORIES.map((item, i) => <button key={item} type="button" onClick={() => setCategory(item)} className={`category-option ${category === item ? 'selected' : ''}`}><span className="category-symbol">{['♻','⌁','≋','☼','▥','?'][i]}</span><span>{item}</span>{category === item && <CheckCircle2 size={15} className="selected-check" />}</button>)}</div><label className="field-label" htmlFor="description">What did you observe? <span className="muted">Required</span></label><textarea id="description" value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe visible facts, not assumptions…" rows={4} maxLength={1200} required /><div className="field-foot"><span>Describe what you can see.</span><span>{description.length}/1200</span></div><label className="field-label">Photograph <span className="muted">Required · JPG, PNG, WebP · max 5 MB</span></label><label className="upload-box"><UploadCloud size={24} /><strong>{photo ? photo.name : 'Choose a photograph'}</strong><span>{photo ? `${(photo.size / 1024 / 1024).toFixed(2)} MB selected` : 'The actual image will be uploaded to private Supabase Storage.'}</span><input type="file" accept="image/jpeg,image/png,image/webp" required={!photo} onChange={e => selectPhoto(e.target.files?.[0])} /></label>{photoError && <p className="error-text">{photoError}</p>}<label className="field-label" htmlFor="location-label">Location label</label><input id="location-label" value={locationLabel} onChange={e => { setLocationLabel(e.target.value); setLocationConfirmed(false); }} placeholder="Sector, street or landmark" /><div className="coord-grid"><div><label className="field-label" htmlFor="lat">Latitude</label><input id="lat" inputMode="decimal" value={latitude} onChange={e => { setLatitude(e.target.value); setLocationConfirmed(false); }} placeholder="28.4744" required /></div><div><label className="field-label" htmlFor="lon">Longitude</label><input id="lon" inputMode="decimal" value={longitude} onChange={e => { setLongitude(e.target.value); setLocationConfirmed(false); }} placeholder="77.5040" required /></div></div><div className="location-actions"><button type="button" className="secondary-btn" onClick={useLocation}><MapPin size={15} /> Use GPS</button><button type="button" className="secondary-btn" onClick={confirmCoordinates}>Confirm coordinates</button>{accuracy !== null && <span className="helper-text">GPS accuracy ±{accuracy} m</span>}{locationConfirmed && <span className="confirmed"><CheckCircle2 size={14} /> Confirmed</span>}</div><div className="divider" /><div className="card-heading"><div><span className="step-label">STEP 02</span><h2>Prepare a complaint</h2></div><span className="icon-bubble"><FileText size={20} /></span></div><label className="field-label">Complaint language</label><div className="segmented"><button type="button" className={language === 'English' ? 'chosen' : ''} onClick={() => { setLanguage('English'); setComplaint(''); }}>English</button><button type="button" className={language === 'Hindi' ? 'chosen' : ''} onClick={() => { setLanguage('Hindi'); setComplaint(''); }}>हिन्दी (Hindi)</button></div><label className="field-label" htmlFor="complaint">Editable complaint draft</label><textarea id="complaint" value={complaint || complaintDraft} onChange={e => setComplaint(e.target.value)} rows={6} /><p className="helper-text">Saving creates an internal CivicLens report. It does not send a complaint to a government authority.</p><button className="primary-btn full-btn" disabled={busy || !locationConfirmed || !photo}>{busy ? 'Uploading photo and saving…' : 'Upload photo & save report'} <ArrowRight size={17} /></button></form>}
    {tab === 'reports' && <section className="card reports-card"><div className="card-heading"><div><span className="step-label">PERSISTENT REPORTS</span><h2>My reports</h2><p className="muted">Loaded from Supabase using your signed-in account.</p></div><button className="secondary-btn" onClick={() => void loadResidentReports()}><RefreshCw size={14} /> Refresh</button></div>{reports.length === 0 ? <div className="empty-state"><div className="empty-icon"><ClipboardList size={27} /></div><h3>No reports yet</h3><p>Your reports will appear here after saving to Supabase.</p></div> : <div className="report-list">{reports.map(r => <ReportCard key={r.id} report={r} history={historyById[r.id] || []} photoUrl={photoUrls[r.id]} role={role} userId={session.user.id} onChanged={() => void loadResidentReports()} />)}</div>}</section>}
    {tab === 'reviewer' && role === 'reviewer' && <section className="card reports-card"><div className="card-heading"><div><span className="step-label">AUTHORIZED REVIEW</span><h2>Reviewer queue</h2><p className="muted">Status changes are validated by PostgreSQL and audited server-side.</p></div><button className="secondary-btn" onClick={() => void loadReviewerReports()}><RefreshCw size={14} /> Refresh</button></div>{reviewReports.length === 0 ? <div className="empty-state"><h3>No reports in the queue</h3><p>Reports from residents will appear after they are saved.</p></div> : <div className="report-list">{reviewReports.map(r => <article className="report-item reviewer-item" key={r.id}><div className="report-icon"><ClipboardList size={19} /></div><div className="report-main"><div className="report-topline"><span className="category-tag">{r.category}</span><span className="demo-tag">{r.data_class.toUpperCase()}</span></div><h3>{r.description}</h3><p><MapPin size={13} /> {r.location_label} · {r.latitude}, {r.longitude}</p><div className="report-meta"><span>Reporter ID: {r.reporter_id}</span><span>Created: {new Date(r.created_at).toLocaleString()}</span><span>Report: {r.id}</span></div>{photoUrls[r.id] && <a className="photo-link" href={photoUrls[r.id]} target="_blank" rel="noreferrer">View private photo (signed link)</a>}<details><summary>Complaint draft</summary><pre>{r.complaint_text}</pre></details>{r.category !== 'Garbage dump' && <div className="review-controls"><label className="field-label" htmlFor={`status-${r.id}`}>Internal status</label><select id={`status-${r.id}`} value={statusDrafts[r.id] || (INTERNAL_STATUSES.includes(r.internal_status as typeof INTERNAL_STATUSES[number]) ? r.internal_status : 'new')} onChange={e => setStatusDrafts(prev => ({ ...prev, [r.id]: e.target.value as InternalStatus }))}>{INTERNAL_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select><label className="field-label" htmlFor={`note-${r.id}`}>Review note</label><input id={`note-${r.id}`} value={reviewNotes[r.id] || ''} onChange={e => setReviewNotes(prev => ({ ...prev, [r.id]: e.target.value }))} placeholder="Optional note for the audit history" /><button className="primary-btn" disabled={busy || (statusDrafts[r.id] || r.internal_status) === r.internal_status} onClick={() => void updateInternalStatus(r.id)}>Save status & history</button></div>}{r.category === 'Garbage dump' && <CheckFixPanel report={r} role={role} userId={session.user.id} beforeUrl={photoUrls[r.id]} onChanged={() => { void loadReviewerReports(); void loadResidentReports(); }} />}</div></article>)}</div>}</section>}
    <footer><span>© CivicLens · Competition prototype</span><span>Internal workflow only; not official dispatch.</span></footer></main></div>;
}

function ReportCard({ report, history, photoUrl, role, userId, onChanged }: { report: CivicReport; history: ReportHistory[]; photoUrl?: string; role: Role; userId: string; onChanged: () => void }) {
  return <article className="report-item"><div className="report-icon"><MapPin size={19} /></div><div className="report-main"><div className="report-topline"><span className="category-tag">{report.category}</span><span className="status-chip">{STATUS_LABELS[report.internal_status]}</span></div><h3>{report.description}</h3><p><MapPin size={13} /> {report.location_label} · {report.latitude}, {report.longitude}</p><div className="report-meta"><span>{new Date(report.created_at).toLocaleString()}</span><span>Ref: {report.id}</span><span>{report.data_class.toUpperCase()} DATA</span></div>{photoUrl && <a className="photo-link" href={photoUrl} target="_blank" rel="noreferrer">View private photo (temporary link)</a>}<details><summary>Complaint draft</summary><pre>{report.complaint_text}</pre></details><details><summary>Status history ({history.length})</summary>{history.length ? <ol className="history-list">{history.map(h => <li key={h.id}><b>{h.internal_status_old ? `${STATUS_LABELS[h.internal_status_old]} → ` : ''}{STATUS_LABELS[h.internal_status_new]}</b><span>{new Date(h.created_at).toLocaleString()}</span>{h.note && <p>{h.note}</p>}<small>{h.actor_role ? `Actor role: ${h.actor_role} · ` : ''}Actor ID: {h.actor_id}</small></li>)}</ol> : <p className="helper-text">No history rows visible yet. Refresh after submission.</p>}</details>{report.category === 'Garbage dump' && <CheckFixPanel report={report} role={role} userId={userId} beforeUrl={photoUrl} onChanged={onChanged} />}</div></article>;
}
