import React, { useState } from 'react';
import { api } from '../api';

const SAMPLE_OPTIONS = ['Split Tape', 'Full Adhesive Tape', 'Quick Rip Tape', 'RED Tape', 'PalletGel', 'Dual-Tack Pallet Tape'];

export default function AddLeadModal({ campaigns, onClose, onCreated, notify }) {
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id || '');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [samples, setSamples] = useState([]);
  const [busy, setBusy] = useState(false);

  const campaign = campaigns.find((c) => c.id === campaignId);

  async function submit() {
    if (!email.trim()) { notify('Email is required.'); return; }
    setBusy(true);
    try {
      await api.createLead({
        campaign_id: campaignId, first_name: first, last_name: last,
        email: email.trim(), company: company.trim(), samples,
      });
      onCreated();
    } catch (e) { notify(e.message); } finally { setBusy(false); }
  }

  function toggle(s) { setSamples((p) => p.includes(s) ? p.filter((x) => x !== s) : [...p, s]); }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-pad">
          <h2>Add a lead</h2>
          <label className="field"><span>Campaign</span>
            <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <div className="row" style={{ gap: 12 }}>
            <label className="field" style={{ flex: 1 }}><span>First name</span><input value={first} onChange={(e) => setFirst(e.target.value)} /></label>
            <label className="field" style={{ flex: 1 }}><span>Last name</span><input value={last} onChange={(e) => setLast(e.target.value)} /></label>
          </div>
          <label className="field"><span>Email</span><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" /></label>
          <label className="field"><span>Company</span><input value={company} onChange={(e) => setCompany(e.target.value)} /></label>

          {campaign?.samples_enabled && (
            <label className="field"><span>Samples requested</span>
              <div className="chip-row">
                {SAMPLE_OPTIONS.map((s) => (
                  <button key={s} type="button" className={`btn sm ${samples.includes(s) ? 'accent' : 'ghost'}`} onClick={() => toggle(s)}>{s}</button>
                ))}
              </div>
            </label>
          )}

          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn" disabled={busy} onClick={submit}>Add lead</button>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
          </div>
          <p className="muted-sm" style={{ marginTop: 10 }}>
            {campaign?.first_email_mode === 'immediate'
              ? 'First email sends right away (staggered if you add several).'
              : `First email sends in ${campaign?.first_email_weeks} weeks.`}
          </p>
        </div>
      </div>
    </div>
  );
}
