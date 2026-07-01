import React, { useEffect, useState } from 'react';
import { api } from '../api';
import ManageCampaigns from './ManageCampaigns';
import Playbook from './Playbook';
import EmailInstructions from './EmailInstructions';

export default function SettingsPanel({ notify, onChanged }) {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.getSettings().then((r) => setS(r.settings)); }, []);
  if (!s) return <div className="empty">Loading…</div>;

  const set = (k) => (e) => setS({ ...s, [k]: e.target.value });
  const setBool = (k) => (e) => setS({ ...s, [k]: e.target.checked ? 'true' : 'false' });

  async function save() {
    setBusy(true);
    try {
      await api.saveSettings({
        send_window_start_hour: s.send_window_start_hour || '8',
        send_window_end_hour: s.send_window_end_hour || '16',
        stagger_seconds_min: s.stagger_seconds_min || '60',
        stagger_seconds_max: s.stagger_seconds_max || '120',
        business_days_only: (s.business_days_only ?? 'true') === 'false' ? 'false' : 'true',
      });
      notify('Settings saved.');
    } catch (e) { notify(e.message); } finally { setBusy(false); }
  }

  return (
    <>
      <h1>Settings</h1>
      <div className="card card-pad" style={{ marginTop: 14 }}>
        <p className="section-title">Sending window &amp; pacing</p>
        <div className="row" style={{ gap: 12 }}>
          <label className="field" style={{ width: 150 }}><span>Window start hour</span><input type="number" value={s.send_window_start_hour || '8'} onChange={set('send_window_start_hour')} /></label>
          <label className="field" style={{ width: 150 }}><span>Window end hour</span><input type="number" value={s.send_window_end_hour || '16'} onChange={set('send_window_end_hour')} /></label>
          <label className="field" style={{ width: 150 }}><span>Min gap (sec)</span><input type="number" value={s.stagger_seconds_min || '60'} onChange={set('stagger_seconds_min')} /></label>
          <label className="field" style={{ width: 150 }}><span>Max gap (sec)</span><input type="number" value={s.stagger_seconds_max || '120'} onChange={set('stagger_seconds_max')} /></label>
        </div>
        <label className="row" style={{ gap: 9, marginTop: 14, alignItems: 'flex-start' }}>
          <input
            type="checkbox"
            style={{ width: 'auto', marginTop: 3 }}
            checked={(s.business_days_only ?? 'true') !== 'false'}
            onChange={setBool('business_days_only')}
          />
          <span>
            <strong style={{ fontWeight: 600 }}>Send emails on weekdays and non-holidays only</strong>
            <span className="muted-sm" style={{ display: 'block', marginTop: 2 }}>
              On by default. Uncheck to let sends fire immediately regardless of weekend, holiday, or send window — useful for testing.
            </span>
          </span>
        </label>
        <p className="muted-sm" style={{ marginTop: 12 }}>All times in America/Indiana/Indianapolis.</p>
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn" disabled={busy} onClick={save}>Save settings</button>
      </div>

      <div className="divider" style={{ margin: '28px 0 20px' }} />
      <EmailInstructions notify={notify} />

      <div className="divider" style={{ margin: '28px 0 20px' }} />
      <ManageCampaigns notify={notify} onChanged={onChanged || (() => {})} />

      <div className="divider" style={{ margin: '28px 0 20px' }} />
      <Playbook notify={notify} />
    </>
  );
}
