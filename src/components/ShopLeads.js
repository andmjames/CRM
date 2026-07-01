import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api';

const SENIORITIES = ['owner', 'founder', 'c_suite', 'partner', 'vp', 'head', 'director', 'manager', 'senior', 'entry'];
const EMP_RANGES = [
  ['1,10', '1–10'], ['11,20', '11–20'], ['21,50', '21–50'], ['51,100', '51–100'],
  ['101,200', '101–200'], ['201,500', '201–500'], ['501,1000', '501–1k'],
  ['1001,2000', '1k–2k'], ['2001,5000', '2k–5k'], ['5001,10000', '5k–10k'], ['10001,50000', '10k+'],
];
const IMPORT_CHUNK = 10;

export default function ShopLeads({ notify }) {
  const [campaigns, setCampaigns] = useState([]);
  const [campaignId, setCampaignId] = useState('');
  const [connected, setConnected] = useState(null); // null=unknown, true/false

  const [titles, setTitles] = useState('');
  const [seniorities, setSeniorities] = useState(new Set());
  const [locations, setLocations] = useState('United States');
  const [ranges, setRanges] = useState(new Set());
  const [keywords, setKeywords] = useState('');
  const [orgKeywords, setOrgKeywords] = useState('');
  const [orgDomains, setOrgDomains] = useState('');
  const [similar, setSimilar] = useState(true);

  const [people, setPeople] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(new Set());
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(null);
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const c = await api.getCampaigns();
        const list = c.campaigns || c || [];
        setCampaigns(list);
        if (list.length) setCampaignId(list[0].id);
      } catch (e) { notify(e.message); }
      try { const h = await api.health(); setConnected(!!(h.env && h.env.APOLLO_API_KEY)); }
      catch { setConnected(null); }
    })();
  }, [notify]);

  const toggle = (setFn) => (val) => setFn((prev) => { const n = new Set(prev); n.has(val) ? n.delete(val) : n.add(val); return n; });
  const toggleSen = toggle(setSeniorities);
  const toggleRange = toggle(setRanges);

  const runSearch = useCallback(async (goPage = 1) => {
    setSearching(true); setSummary(null);
    try {
      const body = {
        titles, seniorities: [...seniorities], locations,
        employee_ranges: [...ranges], keywords, org_keywords: orgKeywords,
        org_domains: orgDomains, include_similar_titles: similar, page: goPage,
      };
      const r = await api.apolloSearch(body);
      setPeople(r.people || []);
      setPagination(r.pagination || null);
      setPage(goPage);
      setSelected(new Set());
      setSearched(true);
    } catch (e) {
      notify(e.message);
      if (/apollo_not_connected/i.test(e.message) || /not connected/i.test(e.message)) setConnected(false);
    } finally { setSearching(false); }
  }, [titles, seniorities, locations, ranges, keywords, orgKeywords, orgDomains, similar, notify]);

  const allSelected = people.length > 0 && selected.size === people.length;
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(people.map((p) => p.apollo_id)));
  }
  function toggleOne(id) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function doImport() {
    if (!campaignId) { notify('Pick a target campaign first.'); return; }
    const chosen = people.filter((p) => selected.has(p.apollo_id));
    if (!chosen.length) return;
    if (!window.confirm(`Import ${chosen.length} lead(s) into this campaign as Cold?\n\nThis reveals each person's email and uses 1 Apollo credit per lead.`)) return;

    setImporting(true); setSummary(null);
    const totals = { imported: 0, no_email: 0, duplicates: 0, suppressed: 0, errors: 0 };
    const chunks = [];
    for (let i = 0; i < chosen.length; i += IMPORT_CHUNK) chunks.push(chosen.slice(i, i + IMPORT_CHUNK));
    try {
      let done = 0;
      for (const chunk of chunks) {
        setProgress({ done, total: chosen.length });
        const payload = chunk.map((p) => ({ apollo_id: p.apollo_id, first_name: p.first_name, last_name: p.last_name, company: p.company, domain: p.domain }));
        const r = await api.apolloImport(campaignId, payload);
        ['imported', 'no_email', 'duplicates', 'suppressed', 'errors'].forEach((k) => { totals[k] += r[k] || 0; });
        done += chunk.length;
        setProgress({ done, total: chosen.length });
      }
      setSummary(totals);
      setSelected(new Set());
      notify(`Imported ${totals.imported} lead(s).`);
    } catch (e) { notify(e.message); } finally { setImporting(false); setProgress(null); }
  }

  return (
    <>
      <h1>Shop for Leads</h1>
      <p className="sub" style={{ marginTop: 0 }}>Search Apollo&rsquo;s database and import prospects straight into a campaign as Cold leads. Searching is free; importing reveals each email and uses 1 Apollo credit per lead.</p>

      {connected === false && (
        <div className="card card-pad" style={{ marginTop: 12, borderColor: 'var(--danger)' }}>
          <strong>Apollo isn&rsquo;t connected.</strong>
          <p className="muted-sm" style={{ margin: '6px 0 0' }}>Add an <code>APOLLO_API_KEY</code> environment variable in Netlify (Site settings → Environment variables) using a <em>master</em> API key from Apollo (Settings → API Keys), then redeploy. Searching and importing will work once it&rsquo;s set.</p>
        </div>
      )}

      <div className="card card-pad" style={{ marginTop: 12 }}>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="field" style={{ minWidth: 260, flex: 1 }}><span>Import into campaign</span>
            <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              {campaigns.length === 0 && <option value="">No campaigns</option>}
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>

        <div className="divider" style={{ margin: '14px 0' }} />

        <label className="field"><span>Job titles (comma-separated)</span>
          <input value={titles} onChange={(e) => setTitles(e.target.value)} placeholder="Owner, Facilities Manager, Purchasing Manager" />
        </label>

        <div className="field"><span>Seniority</span>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
            {SENIORITIES.map((s) => (
              <button key={s} type="button" className={`btn sm ${seniorities.has(s) ? '' : 'ghost'}`} onClick={() => toggleSen(s)} style={{ textTransform: 'capitalize' }}>{s.replace('_', ' ')}</button>
            ))}
          </div>
        </div>

        <label className="field"><span>Locations (comma-separated)</span>
          <input value={locations} onChange={(e) => setLocations(e.target.value)} placeholder="United States, California US, Texas US" />
        </label>

        <div className="field"><span>Company size (employees)</span>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
            {EMP_RANGES.map(([val, label]) => (
              <button key={val} type="button" className={`btn sm ${ranges.has(val) ? '' : 'ghost'}`} onClick={() => toggleRange(val)}>{label}</button>
            ))}
          </div>
        </div>

        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <label className="field" style={{ flex: 1, minWidth: 220 }}><span>Company keywords (industry / niche)</span>
            <input value={orgKeywords} onChange={(e) => setOrgKeywords(e.target.value)} placeholder="flooring, gym flooring, contractor" />
          </label>
          <label className="field" style={{ flex: 1, minWidth: 220 }}><span>General keywords</span>
            <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="optional free-text" />
          </label>
        </div>

        <label className="field"><span>Company domains (comma-separated, optional)</span>
          <input value={orgDomains} onChange={(e) => setOrgDomains(e.target.value)} placeholder="acme.com, example.com" />
        </label>

        <label className="row" style={{ gap: 8, alignItems: 'center', marginTop: 4 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={similar} onChange={(e) => setSimilar(e.target.checked)} />
          <span>Include similar job titles</span>
        </label>

        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn" disabled={searching || connected === false} onClick={() => runSearch(1)}>{searching ? 'Searching…' : 'Search Apollo'}</button>
        </div>
      </div>

      {searched && (
        <div className="card card-pad" style={{ marginTop: 16 }}>
          <div className="row" style={{ alignItems: 'center', marginBottom: 10 }}>
            <strong>{pagination ? (pagination.total_entries || 0).toLocaleString() : 0} matches</strong>
            <span className="muted-sm" style={{ marginLeft: 8 }}>{people.length ? `showing ${people.length}` : ''}</span>
            <div className="spacer" />
            {people.length > 0 && (
              <button className="btn sm ghost" onClick={toggleAll}>{allSelected ? 'Clear' : 'Select all'}</button>
            )}
          </div>

          {people.length === 0 && <p className="muted-sm">No matches. Loosen your filters and try again.</p>}

          {people.map((p) => (
            <div className="card" key={p.apollo_id} style={{ padding: '8px 12px', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={selected.has(p.apollo_id)} onChange={() => toggleOne(p.apollo_id)} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14 }}>
                  <strong>{p.first_name} {p.last_name}{p.last_obfuscated ? ' (last name hidden until import)' : ''}</strong>
                  {p.title ? <span className="muted-sm"> · {p.title}</span> : null}
                </div>
                <div className="muted-sm">
                  {p.company}{p.domain ? ` · ${p.domain}` : ''}{(p.city || p.state || p.country) ? ` · ${[p.city, p.state, p.country].filter(Boolean).join(', ')}` : ''}
                </div>
              </div>
              {p.linkedin_url ? <a className="muted-sm" href={p.linkedin_url} target="_blank" rel="noreferrer">LinkedIn</a> : null}
            </div>
          ))}

          {pagination && pagination.total_pages > 1 && (
            <div className="row" style={{ marginTop: 10, alignItems: 'center' }}>
              <button className="btn sm ghost" disabled={page <= 1 || searching} onClick={() => runSearch(page - 1)}>Prev</button>
              <span className="muted-sm" style={{ margin: '0 10px' }}>Page {page} of {Math.min(pagination.total_pages, 500)}</span>
              <button className="btn sm ghost" disabled={page >= pagination.total_pages || page >= 500 || searching} onClick={() => runSearch(page + 1)}>Next</button>
            </div>
          )}

          {people.length > 0 && (
            <div className="row" style={{ marginTop: 14, alignItems: 'center' }}>
              <button className="btn" disabled={importing || selected.size === 0 || !campaignId} onClick={doImport}>
                {importing ? 'Importing…' : `Import ${selected.size || ''} selected as Cold`}
              </button>
              {progress && <span className="muted-sm" style={{ marginLeft: 10 }}>{progress.done}/{progress.total} enriched…</span>}
            </div>
          )}

          {summary && (
            <div className="card" style={{ padding: '10px 12px', marginTop: 12 }}>
              <strong>Import complete.</strong>
              <div className="muted-sm" style={{ marginTop: 4 }}>
                {summary.imported} imported · {summary.duplicates} already in system · {summary.no_email} no email found · {summary.suppressed} on Do-Not-Contact{summary.errors ? ` · ${summary.errors} errors` : ''}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
