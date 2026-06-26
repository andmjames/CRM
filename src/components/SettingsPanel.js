import React, { useEffect, useState } from 'react';
import { api } from '../api';

export default function SettingsPanel({ notify }) {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.getSettings().then((r) => setS(r.settings)); }, []);
  if (!s) return <div className="empty">Loading…</div>;

  const set = (k) => (e) => setS({ ...s, [k]: e.target.value });

  async function save() {
    setBusy(true);
    try {
      await api.saveSettings({
        global_style_corrections: s.global_style_corrections || '',
        send_window_start_hour: s.send_window_start_hour || '8',
        send_window_end_hour: s.send_window_end_hour || '16',
        stagger_seconds_min: s.stagger_seconds_min || '60',
        stagger_seconds_max: s.stagger_seconds_max || '120',
      });
      notify('Settings saved — applies to future AI-generated messages.');
    } catch (e) { notify(e.message); } finally { setBusy(false); }
  }

  return (
    <>
      <h1>Settings</h1>
      <div className="card card-pad" style={{ marginTop: 14 }}>
        <p className="section-title">Global style corrections</p>
        <p className="muted-sm" style={{ marginTop: -4, marginBottom: 8 }}>
          Overall rules applied to every AI-generated email, draft, and comment. Use this for blanket changes — e.g. “Always sign off with ‘Thank you,’ never ‘Regards.’”
        </p>
        <textarea value={s.global_style_corrections || ''} onChange={set('global_style_corrections')} style={{ minHeight: 130 }} />
      </div>

      <div className="card card-pad" style={{ marginTop: 16 }}>
        <p className="section-title">Sending window &amp; pacing</p>
        <div className="row" style={{ gap: 12 }}>
          <label className="field" style={{ width: 150 }}><span>Window start hour</span><input type="number" value={s.send_window_start_hour || '8'} onChange={set('send_window_start_hour')} /></label>
          <label className="field" style={{ width: 150 }}><span>Window end hour</span><input type="number" value={s.send_window_end_hour || '16'} onChange={set('send_window_end_hour')} /></label>
          <label className="field" style={{ width: 150 }}><span>Min gap (sec)</span><input type="number" value={s.stagger_seconds_min || '60'} onChange={set('stagger_seconds_min')} /></label>
          <label className="field" style={{ width: 150 }}><span>Max gap (sec)</span><input type="number" value={s.stagger_seconds_max || '120'} onChange={set('stagger_seconds_max')} /></label>
        </div>
        <p className="muted-sm">All times in America/Indiana/Indianapolis. Sends only happen on weekdays, never on your holiday list.</p>
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn" disabled={busy} onClick={save}>Save settings</button>
      </div>
    </>
  );
}
