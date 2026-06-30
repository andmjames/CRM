import React, { useState } from 'react';
import { api } from '../api';

const SAMPLE_OPTIONS = ['Split Tape', 'Full Adhesive Tape', 'Quick Rip Tape', 'RED Tape', 'PalletGel', 'Dual-Tack Pallet Tape'];

/* ---------- CSV helpers ---------- */
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* ignore */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
}

function rowsToLeads(text, samplesEnabled) {
  const grid = parseCSV(text);
  if (!grid.length) return [];
  const header = grid[0].map((h) => h.trim().toLowerCase());
  const idx = (names) => header.findIndex((h) => names.includes(h));
  const iFirst = idx(['first_name', 'first name', 'first']);
  const iLast = idx(['last_name', 'last name', 'last']);
  const iEmail = idx(['email', 'e-mail']);
  const iCompany = idx(['company', 'company name']);
  const iSamples = idx(['samples', 'samples requested']);
  return grid.slice(1).map((r) => {
    const lead = {
      first_name: iFirst >= 0 ? (r[iFirst] || '').trim() : '',
      last_name: iLast >= 0 ? (r[iLast] || '').trim() : '',
      email: iEmail >= 0 ? (r[iEmail] || '').trim() : '',
      company: iCompany >= 0 ? (r[iCompany] || '').trim() : '',
    };
    if (samplesEnabled && iSamples >= 0) {
      lead.samples = (r[iSamples] || '').split(/[;|]/).map((s) => s.trim()).filter(Boolean);
    }
    return lead;
  });
}

function downloadTemplate(campaign) {
  const cols = ['first_name', 'last_name', 'email', 'company'];
  if (campaign.samples_enabled) cols.push('samples');
  const example = campaign.samples_enabled
    ? ['Jane', 'Doe', 'jane@example.com', 'Acme Signs', 'Split Tape; RED Tape']
    : ['Jane', 'Doe', 'jane@example.com', 'Acme Hardware'];
  const csv = `${cols.join(',')}\n${example.map((v) => /[,";]/.test(v) ? `"${v}"` : v).join(',')}\n`;
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${campaign.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-template.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/* ---------- Component ---------- */
export default function AddLeadModal({ campaigns, onClose, onCreated, notify }) {
  const [mode, setMode] = useState('single'); // single | import
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id || '');
  const campaign = campaigns.find((c) => c.id === campaignId);

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-pad">
          <div className="row" style={{ marginBottom: 6 }}>
            <button className={`btn sm ${mode === 'single' ? '' : 'ghost'}`} onClick={() => setMode('single')}>Add a lead</button>
            <button className={`btn sm ${mode === 'import' ? '' : 'ghost'}`} onClick={() => setMode('import')}>Import from a spreadsheet</button>
          </div>

          {mode === 'single' ? (
            <SingleLead campaigns={campaigns} campaignId={campaignId} setCampaignId={setCampaignId} campaign={campaign} onCreated={onCreated} onClose={onClose} notify={notify} />
          ) : (
            <ImportLeads campaigns={campaigns} campaignId={campaignId} setCampaignId={setCampaignId} campaign={campaign} onDone={onCreated} onClose={onClose} notify={notify} />
          )}
        </div>
      </div>
    </div>
  );
}

function SingleLead({ campaigns, campaignId, setCampaignId, campaign, onCreated, onClose, notify }) {
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [status, setStatus] = useState('cold');
  const [samples, setSamples] = useState([]);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email.trim()) { notify('Email is required.'); return; }
    setBusy(true);
    try {
      await api.createLead({ campaign_id: campaignId, first_name: first, last_name: last, email: email.trim(), company: company.trim(), samples, status });
      onCreated();
    } catch (e) { notify(e.message); } finally { setBusy(false); }
  }
  function toggle(s) { setSamples((p) => p.includes(s) ? p.filter((x) => x !== s) : [...p, s]); }

  return (
    <>
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
      <label className="field"><span>Status</span>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="cold">Cold</option>
          <option value="dialogue">Dialogue</option>
          <option value="current_customer">Current Customer</option>
          <option value="inactive">Inactive</option>
        </select>
      </label>

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
        {status !== 'cold'
          ? `Added directly as a ${status === 'current_customer' ? 'Current Customer' : status.charAt(0).toUpperCase() + status.slice(1)} lead — no automatic cold emails.`
          : campaign?.first_email_mode === 'immediate'
            ? 'First email sends right away (staggered if you add several).'
            : `First email sends in ${campaign?.first_email_weeks} weeks.`}
      </p>
    </>
  );
}

function ImportLeads({ campaigns, campaignId, setCampaignId, campaign, onDone, onClose, notify }) {
  const [parsed, setParsed] = useState(null); // array of lead rows
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const leads = rowsToLeads(String(reader.result), campaign?.samples_enabled);
        const withEmail = leads.filter((l) => l.email);
        setParsed(withEmail);
        if (withEmail.length === 0) notify('No rows with an email found — check the file matches the template.');
      } catch (err) { notify('Could not read that file.'); }
    };
    reader.readAsText(file);
  }

  async function runImport() {
    if (!parsed?.length) return;
    setBusy(true);
    try {
      const r = await api.importLeads(campaignId, parsed);
      setResult(r);
    } catch (e) { notify(e.message); } finally { setBusy(false); }
  }

  if (result) {
    return (
      <>
        <h2>Import complete</h2>
        <p style={{ margin: '8px 0' }}><strong>{result.created}</strong> lead{result.created === 1 ? '' : 's'} added of {result.total} row{result.total === 1 ? '' : 's'}.</p>
        {result.skipped?.length > 0 && (
          <div className="card card-pad" style={{ background: 'var(--bg2)', marginTop: 6 }}>
            <p className="muted-sm" style={{ marginBottom: 6 }}>{result.skipped.length} skipped:</p>
            <div style={{ maxHeight: 200, overflow: 'auto' }}>
              {result.skipped.map((s, i) => (
                <div key={i} className="muted-sm">{s.email} — {s.reason}</div>
              ))}
            </div>
          </div>
        )}
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn" onClick={onDone}>Done</button>
        </div>
      </>
    );
  }

  return (
    <>
      <h2>Import leads from a spreadsheet</h2>
      <label className="field"><span>Campaign</span>
        <select value={campaignId} onChange={(e) => { setCampaignId(e.target.value); setParsed(null); setFileName(''); }}>
          {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>

      <div className="card card-pad" style={{ background: 'var(--bg2)', marginBottom: 4 }}>
        <p className="muted-sm" style={{ marginBottom: 8 }}>
          Step 1 — download the template for <strong>{campaign?.name}</strong>, fill it in, and save as CSV.
          {campaign?.samples_enabled && ' Separate multiple samples with a semicolon (;).'}
        </p>
        <button className="btn ghost sm" onClick={() => downloadTemplate(campaign)}>Download template (.csv)</button>
      </div>

      <label className="field" style={{ marginTop: 14 }}>
        <span>Step 2 — upload your filled-in CSV</span>
        <input type="file" accept=".csv,text/csv" onChange={onFile} />
      </label>
      {fileName && parsed && (
        <p className="muted-sm">{fileName}: {parsed.length} lead{parsed.length === 1 ? '' : 's'} ready to import into {campaign?.name}.</p>
      )}

      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn" disabled={busy || !parsed?.length} onClick={runImport}>
          {busy ? 'Importing…' : `Import ${parsed?.length || 0} lead${parsed?.length === 1 ? '' : 's'}`}
        </button>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
      </div>
      <p className="muted-sm" style={{ marginTop: 10 }}>
        Duplicates and Do-Not-Contact emails are skipped automatically. {campaign?.first_email_mode === 'immediate'
          ? 'First emails send right away, staggered.'
          : `First emails send in ${campaign?.first_email_weeks} weeks.`}
      </p>
    </>
  );
}
