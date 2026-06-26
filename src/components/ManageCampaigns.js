import React, { useEffect, useState } from 'react';
import { api } from '../api';

const BLANK = {
  name: '', brand: '', front_channel_address: '', audience_type: 'retailers',
  product_info: '', style_guide: '', first_email_mode: 'immediate', first_email_weeks: 0,
  followup_weeks: '4,6,8,12,16,20,24,28,32,36,40', max_emails: 12, samples_enabled: false,
  subject: '', body: 'Hello FIRST_NAME,',
};

export default function ManageCampaigns({ notify, onChanged }) {
  const [campaigns, setCampaigns] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [editing, setEditing] = useState(null); // campaign id or 'new'
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const res = await api.getCampaigns();
    setCampaigns(res.campaigns); setTemplates(res.templates);
  };
  useEffect(() => { load(); }, []);

  function startEdit(c) {
    const tpl = templates.find((t) => t.campaign_id === c.id) || {};
    setForm({
      ...c,
      followup_weeks: (c.followup_weeks || []).join(','),
      subject: tpl.subject || '', body: tpl.body || 'Hello FIRST_NAME,',
    });
    setEditing(c.id);
  }
  function startNew() { setForm(BLANK); setEditing('new'); }

  async function save() {
    setBusy(true);
    try {
      const payload = {
        ...form,
        first_email_weeks: Number(form.first_email_weeks) || 0,
        max_emails: Number(form.max_emails) || 12,
        followup_weeks: String(form.followup_weeks).split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n)),
        samples_enabled: !!form.samples_enabled,
      };
      if (editing === 'new') await api.createCampaign(payload);
      else await api.updateCampaign({ id: editing, ...payload });
      notify('Campaign saved.');
      setEditing(null); await load(); onChanged();
    } catch (e) { notify(e.message); } finally { setBusy(false); }
  }

  async function remove(c) {
    if (!window.confirm(`Remove "${c.name}" and all its leads? This can't be undone.`)) return;
    await api.deleteCampaign(c.id);
    notify('Campaign removed.'); await load(); onChanged();
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  if (editing) {
    return (
      <>
        <button className="back" onClick={() => setEditing(null)}>← Back to campaigns</button>
        <h1>{editing === 'new' ? 'New campaign' : 'Edit campaign'}</h1>
        <div className="card card-pad" style={{ marginTop: 14 }}>
          <label className="field"><span>Campaign name</span><input value={form.name} onChange={set('name')} placeholder="FloorBond to Carpet Tile Makers" /></label>
          <div className="row" style={{ gap: 12 }}>
            <label className="field" style={{ flex: 1 }}><span>Brand</span><input value={form.brand} onChange={set('brand')} placeholder="FloorBond" /></label>
            <label className="field" style={{ flex: 2 }}><span>Sender (Front channel address)</span><input value={form.front_channel_address} onChange={set('front_channel_address')} placeholder="andrew@floorbondtape.com" /></label>
          </div>

          <label className="field"><span>Product info (used by AI for follow-ups)</span><textarea value={form.product_info} onChange={set('product_info')} /></label>
          <label className="field"><span>Style guide (tone for AI follow-ups)</span><textarea value={form.style_guide} onChange={set('style_guide')} /></label>

          <div className="divider" />
          <p className="section-title">First email</p>
          <div className="row" style={{ gap: 12 }}>
            <label className="field" style={{ flex: 1 }}><span>When to send</span>
              <select value={form.first_email_mode} onChange={set('first_email_mode')}>
                <option value="immediate">Immediately on creation</option>
                <option value="weeks">Weeks after creation</option>
              </select>
            </label>
            {form.first_email_mode === 'weeks' && (
              <label className="field" style={{ width: 120 }}><span>Weeks</span><input type="number" value={form.first_email_weeks} onChange={set('first_email_weeks')} /></label>
            )}
          </div>
          <label className="field"><span>Email 1 subject</span><input value={form.subject} onChange={set('subject')} /></label>
          <label className="field"><span>Email 1 body — use FIRST_NAME and SAMPLES as placeholders</span><textarea value={form.body} onChange={set('body')} style={{ minHeight: 140 }} /></label>

          <div className="divider" />
          <p className="section-title">Follow-ups (AI-generated)</p>
          <label className="field"><span>Weeks after each previous email (comma-separated)</span><input value={form.followup_weeks} onChange={set('followup_weeks')} placeholder="4,6,8,12,16,20,24,28,32,36,40" /></label>
          <div className="row" style={{ gap: 12 }}>
            <label className="field" style={{ width: 160 }}><span>Hard cap (total emails)</span><input type="number" value={form.max_emails} onChange={set('max_emails')} /></label>
            <label className="row" style={{ gap: 8, marginTop: 22 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={!!form.samples_enabled} onChange={set('samples_enabled')} />
              <span>Track sample selection (PMI-style)</span>
            </label>
          </div>

          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn" disabled={busy} onClick={save}>Save campaign</button>
            <button className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="row">
        <h1 style={{ margin: 0 }}>Campaigns</h1>
        <div className="spacer" />
        <button className="btn accent" onClick={startNew}>+ New campaign</button>
      </div>
      <p className="sub" style={{ margin: '6px 0 18px' }}>Edit wording, intervals, and tone here. Changes apply to future emails for leads without their own edits.</p>

      {campaigns.map((c) => (
        <div className="card campaign" key={c.id}>
          <div className="campaign-head" style={{ cursor: 'default' }}>
            <div>
              <h2>{c.name}</h2>
              <div className="campaign-meta">
                {c.front_channel_address} · first email {c.first_email_mode === 'immediate' ? 'immediate' : `${c.first_email_weeks}w`} ·
                {' '}{(c.followup_weeks || []).length} follow-ups · cap {c.max_emails}
              </div>
            </div>
            <div className="row">
              <button className="btn ghost sm" onClick={() => startEdit(c)}>Edit</button>
              <button className="btn ghost sm danger" onClick={() => remove(c)}>Remove</button>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
