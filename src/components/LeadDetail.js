import React, { useEffect, useState } from 'react';
import { api } from '../api';

const STATUSES = [
  ['cold', 'Cold'], ['dialogue', 'Dialogue'],
  ['current_customer', 'Current customer'], ['inactive', 'Inactive'],
];
const SAMPLE_OPTIONS = ['Split Tape', 'Full Adhesive Tape', 'Quick Rip Tape', 'RED Tape', 'PalletGel', 'Dual-Tack Pallet Tape'];

function fmt(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Indiana/Indianapolis',
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}
function dateInput(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Indiana/Indianapolis' });
}

export default function LeadDetail({ id, onBack, onChanged, notify }) {
  const [d, setD] = useState(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const res = await api.getLead(id);
    setD(res);
    setNotes(res.lead.notes || '');
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!d) return <div className="empty">Loading lead…</div>;
  const { lead, campaign, companyName, upcoming, history } = d;

  async function patchLead(patch) {
    await api.updateLead({ id, ...patch });
    await load(); onChanged();
  }

  async function saveNotes() {
    setSaving(true);
    try { await patchLead({ notes }); notify('Notes saved.'); }
    finally { setSaving(false); }
  }

  function toggleSample(s) {
    const next = lead.samples.includes(s) ? lead.samples.filter((x) => x !== s) : [...lead.samples, s];
    patchLead({ samples: next });
  }

  return (
    <>
      <button className="back" onClick={onBack}>← Back to dashboard</button>
      <div className="row" style={{ marginBottom: 4 }}>
        <h1 style={{ margin: 0 }}>{[lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email}</h1>
      </div>
      <p className="sub" style={{ marginBottom: 18 }}>
        {lead.email} · {companyName || 'No company'} · {campaign?.name}
      </p>

      <div className="detail-grid">
        {/* LEFT: schedule */}
        <div>
          <div className="card card-pad" style={{ marginBottom: 18 }}>
            <p className="section-title">Upcoming</p>
            {upcoming.length === 0 && <div className="muted-sm">Nothing queued. {lead.status === 'cold' ? 'The sequence may be complete or capped.' : 'Automated sends are off for this status.'}</div>}
            {upcoming.map((a) => <UpcomingItem key={a.id} action={a} onSaved={() => { load(); onChanged(); }} notify={notify} />)}
          </div>

          <div className="card card-pad">
            <p className="section-title">History</p>
            {history.length === 0 && <div className="muted-sm">No messages sent yet.</div>}
            {history.map((h) => (
              <div key={h.id} className="upcoming-item">
                <div className="upcoming-head">
                  <strong>{labelFor(h.action_type)} · step {h.step}</strong>
                  <span className="muted-sm">{fmt(h.executed_at)}</span>
                </div>
                {h.subject && <div className="muted-sm" style={{ marginBottom: 4 }}>{h.subject}</div>}
                <div style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{h.generated_body}</div>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT: controls */}
        <div>
          <div className="card card-pad" style={{ marginBottom: 18 }}>
            <p className="section-title">Status</p>
            <select value={lead.status} onChange={(e) => patchLead({ status: e.target.value })}>
              {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <label className="row" style={{ marginTop: 12, gap: 8 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={lead.paused} onChange={(e) => patchLead({ paused: e.target.checked })} />
              <span>Pause all scheduled actions (keeps place in sequence)</span>
            </label>
          </div>

          {campaign?.samples_enabled && (
            <div className="card card-pad" style={{ marginBottom: 18 }}>
              <p className="section-title">Samples requested</p>
              <div className="chip-row">
                {SAMPLE_OPTIONS.map((s) => (
                  <button key={s} className={`btn sm ${lead.samples.includes(s) ? 'accent' : 'ghost'}`} onClick={() => toggleSample(s)}>{s}</button>
                ))}
              </div>
            </div>
          )}

          <div className="card card-pad">
            <p className="section-title">Notes (internal)</p>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything you want to remember about this lead…" />
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn sm" disabled={saving || notes === (lead.notes || '')} onClick={saveNotes}>Save notes</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function labelFor(t) { return t === 'send' ? 'Email' : t === 'draft' ? 'Draft' : 'Comment'; }

function UpcomingItem({ action, onSaved, notify }) {
  const [edit, setEdit] = useState(false);
  const [subject, setSubject] = useState(action.subject || '');
  const [body, setBody] = useState(action.generated_body || '');
  const [date, setDate] = useState(dateInput(action.scheduled_for));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.updateAction({ id: action.id, subject, body, scheduled_for_date: date });
      notify('Updated — this change applies to this lead only.');
      setEdit(false); onSaved();
    } catch (e) { notify(e.message); } finally { setBusy(false); }
  }
  async function cancel() {
    if (!window.confirm('Cancel this scheduled message?')) return;
    await api.updateAction({ id: action.id, cancel: true });
    notify('Canceled.'); onSaved();
  }
  async function reschedule() {
    setBusy(true);
    try { await api.updateAction({ id: action.id, scheduled_for_date: date }); notify('Rescheduled.'); onSaved(); }
    finally { setBusy(false); }
  }

  return (
    <div className="upcoming-item">
      <div className="upcoming-head">
        <strong>{labelFor(action.action_type)} · step {action.step}{action.is_override ? ' · edited' : ''}</strong>
        <span className="muted-sm">{fmt(action.scheduled_for)}</span>
      </div>
      {!edit ? (
        <>
          {action.subject && <div className="muted-sm" style={{ marginBottom: 4 }}>{action.subject}</div>}
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, marginBottom: 8 }}>{action.generated_body || <em className="muted-sm">Generates after the previous email sends.</em>}</div>
          <div className="row">
            <button className="btn ghost sm" onClick={() => setEdit(true)}>Edit</button>
            <label className="row" style={{ gap: 6, margin: 0 }}>
              <input type="date" style={{ width: 'auto' }} value={date} onChange={(e) => setDate(e.target.value)} />
              <button className="btn ghost sm" disabled={busy} onClick={reschedule}>Reschedule</button>
            </label>
            <div className="spacer" />
            <button className="btn ghost sm danger" onClick={cancel}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          {action.action_type === 'send' && (
            <label className="field"><span>Subject</span>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
          )}
          <label className="field"><span>Message</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} /></label>
          <label className="field"><span>Send date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <div className="row">
            <button className="btn sm" disabled={busy} onClick={save}>Save for this lead</button>
            <button className="btn ghost sm" onClick={() => setEdit(false)}>Discard</button>
          </div>
        </>
      )}
    </div>
  );
}
