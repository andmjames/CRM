import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api';

const ZONE = 'America/Indiana/Indianapolis';
function fmtDateTime(iso) {
  return new Date(iso).toLocaleString('en-US', { timeZone: ZONE, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function fmtDay(iso) {
  return new Date(iso).toLocaleDateString('en-US', { timeZone: ZONE, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}
function dayKey(iso) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: ZONE });
}
function dateInputVal(iso) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: ZONE });
}
function typeLabel(t) { return t === 'send' ? 'Email' : t === 'draft' ? 'Draft' : 'Comment'; }

export default function UpcomingEmails({ onOpenLead, notify }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try { const r = await api.upcoming(); setItems(r.upcoming); }
    catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return <div className="empty">Couldn't load upcoming emails: {error}</div>;
  if (!items) return <div className="empty">Loading…</div>;

  // Group by local day.
  const groups = {};
  items.forEach((a) => { (groups[dayKey(a.scheduled_for)] ||= []).push(a); });
  const dayKeys = Object.keys(groups).sort();

  return (
    <>
      <div className="row">
        <h1 style={{ margin: 0 }}>Upcoming emails</h1>
        <div className="spacer" />
        <span className="muted-sm">{items.length} queued</span>
      </div>
      <p className="sub" style={{ margin: '6px 0 18px' }}>Everything the system plans to send next, across all leads. Edit the wording or timing of any of them here.</p>

      {items.length === 0 && <div className="card"><div className="empty">Nothing queued right now.</div></div>}

      {dayKeys.map((k) => (
        <div key={k} style={{ marginBottom: 18 }}>
          <p className="section-title">{fmtDay(groups[k][0].scheduled_for)} · {groups[k].length}</p>
          <div className="card card-pad">
            {groups[k].map((a) => (
              <UpcomingRow key={a.id} action={a} onChanged={load} onOpenLead={onOpenLead} notify={notify} />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function UpcomingRow({ action, onChanged, onOpenLead, notify }) {
  const [edit, setEdit] = useState(false);
  const [subject, setSubject] = useState(action.subject || '');
  const [body, setBody] = useState(action.generated_body || '');
  const [date, setDate] = useState(dateInputVal(action.scheduled_for));
  const [busy, setBusy] = useState(false);

  const lead = action.lead || {};
  const who = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email || 'Unknown';

  async function save() {
    setBusy(true);
    try {
      await api.updateAction({ id: action.id, subject, body, scheduled_for_date: date });
      notify('Updated.'); setEdit(false); onChanged();
    } catch (e) { notify(e.message); } finally { setBusy(false); }
  }
  async function cancel() {
    if (!window.confirm(`Cancel this ${typeLabel(action.action_type).toLowerCase()} to ${who}?`)) return;
    await api.updateAction({ id: action.id, cancel: true });
    notify('Canceled.'); onChanged();
  }

  return (
    <div className="upcoming-item">
      <div className="upcoming-head">
        <strong>
          {typeLabel(action.action_type)} · step {action.step}
          {action.is_override ? ' · edited' : ''}
          {lead.paused ? ' · lead paused' : ''}
        </strong>
        <span className="muted-sm">{fmtDateTime(action.scheduled_for)}</span>
      </div>
      <div className="muted-sm" style={{ marginBottom: 6 }}>
        To <button className="linklike" onClick={() => onOpenLead(action.lead_id)}>{who}</button>
        {lead.email ? ` (${lead.email})` : ''}{action.campaign?.name ? ` · ${action.campaign.name}` : ''}
      </div>

      {!edit ? (
        <>
          {action.subject && <div style={{ fontWeight: 500, marginBottom: 3 }}>{action.subject}</div>}
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, marginBottom: 8 }}>
            {action.generated_body || (
              <em className="muted-sm">
                {action.action_type === 'draft'
                  ? 'Written from the live conversation when this date arrives.'
                  : action.action_type === 'comment'
                    ? 'Reminder comment posts on this date.'
                    : 'Generated when its scheduled time arrives.'}
              </em>
            )}
          </div>
          <div className="row">
            <button className="btn ghost sm" onClick={() => setEdit(true)}>Edit</button>
            <div className="spacer" />
            <button className="btn ghost sm danger" onClick={cancel}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          {action.action_type === 'send' && (
            <label className="field"><span>Subject</span><input value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
          )}
          <label className="field"><span>Message</span><textarea value={body} onChange={(e) => setBody(e.target.value)} style={{ minHeight: 120 }} /></label>
          <label className="field"><span>Send date</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <div className="row">
            <button className="btn sm" disabled={busy} onClick={save}>Save</button>
            <button className="btn ghost sm" onClick={() => setEdit(false)}>Discard</button>
          </div>
        </>
      )}
    </div>
  );
}
