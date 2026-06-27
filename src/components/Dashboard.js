import React, { useState, useEffect } from 'react';
import { api } from '../api';

const STATUS_LABEL = {
  cold: 'Cold', dialogue: 'Dialogue', current_customer: 'Current customer', inactive: 'Inactive',
};
const ZONE = 'America/Indiana/Indianapolis';
function fmtWhen(iso) {
  return new Date(iso).toLocaleString('en-US', { timeZone: ZONE, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function typeLabel(t) { return t === 'send' ? 'Email' : t === 'draft' ? 'Draft' : 'Comment'; }

function StatusPill({ status }) {
  return (
    <span className={`pill ${status}`}><span className="dot" />{STATUS_LABEL[status] || status}</span>
  );
}

export default function Dashboard({ data, onOpenLead, onViewUpcoming }) {
  const { campaigns, companies, leads, stats } = data;
  const [open, setOpen] = useState(() => (campaigns[0] ? { [campaigns[0].id]: true } : {}));
  const [upcoming, setUpcoming] = useState(null);

  useEffect(() => {
    let alive = true;
    api.upcoming().then((r) => { if (alive) setUpcoming(r.upcoming); }).catch(() => { if (alive) setUpcoming([]); });
    return () => { alive = false; };
  }, []);

  const leadsByCampaign = {};
  leads.forEach((l) => { (leadsByCampaign[l.campaign_id] ||= []).push(l); });
  const companiesByCampaign = {};
  companies.forEach((c) => { (companiesByCampaign[c.campaign_id] ||= []).push(c); });

  const preview = (upcoming || []).slice(0, 6);

  return (
    <>
      <h1>Outreach dashboard</h1>
      <p className="sub" style={{ marginBottom: 20 }}>Every campaign reaches out and follows up on its own. You handle the replies.</p>

      <div className="stat-grid">
        <div className="stat"><div className="n">{stats.totalLeads}</div><div className="l">Total leads</div></div>
        <div className="stat"><div className="n" style={{ color: 'var(--current)' }}>{stats.byStatus.cold || 0}</div><div className="l">Cold</div></div>
        <div className="stat"><div className="n" style={{ color: 'var(--current)' }}>{stats.byStatus.dialogue || 0}</div><div className="l">In dialogue</div></div>
        <div className="stat"><div className="n" style={{ color: 'var(--current)' }}>{stats.byStatus.current_customer || 0}</div><div className="l">Current customers</div></div>
        <div className="stat"><div className="n" style={{ color: 'var(--success)' }}>{stats.sendsNext7Days}</div><div className="l">Sends next 7 days</div></div>
      </div>

      {/* Upcoming automatic actions */}
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="row" style={{ marginBottom: 10 }}>
          <p className="section-title" style={{ margin: 0 }}>Upcoming automatic actions</p>
          <div className="spacer" />
          {upcoming && upcoming.length > 0 && (
            <button className="linklike" onClick={onViewUpcoming}>View all {upcoming.length} →</button>
          )}
        </div>
        {!upcoming && <div className="muted-sm">Loading…</div>}
        {upcoming && upcoming.length === 0 && <div className="muted-sm">Nothing queued right now. Add or import leads to start outreach.</div>}
        {preview.map((a) => {
          const lead = a.lead || {};
          const who = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email || 'Unknown';
          return (
            <div key={a.id} className="auto-row" onClick={() => onOpenLead(a.lead_id)}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>
                  <span className="pill cold" style={{ marginRight: 8 }}>{typeLabel(a.action_type)}</span>
                  {who}
                </div>
                <div className="lead-email" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.subject || a.generated_body || 'Generates after the previous email sends'}
                  {a.campaign?.name ? ` · ${a.campaign.name}` : ''}
                </div>
              </div>
              <span className="muted-sm" style={{ whiteSpace: 'nowrap', marginLeft: 12 }}>{fmtWhen(a.scheduled_for)}</span>
            </div>
          );
        })}
      </div>

      {campaigns.map((c) => {
        const cos = (companiesByCampaign[c.id] || []).slice().sort((a, b) => a.name.localeCompare(b.name));
        const cleads = leadsByCampaign[c.id] || [];
        const leadsByCompany = {};
        cleads.forEach((l) => { (leadsByCompany[l.company_id || 'none'] ||= []).push(l); });
        const isOpen = !!open[c.id];
        return (
          <div className="card campaign" key={c.id}>
            <div className="campaign-head" onClick={() => setOpen((o) => ({ ...o, [c.id]: !o[c.id] }))}>
              <div>
                <h2>{c.name}</h2>
                <div className="campaign-meta">{c.front_channel_address} · {cleads.length} leads</div>
              </div>
              <div className="row">
                <span className="muted-sm">{isOpen ? '▾' : '▸'}</span>
              </div>
            </div>

            {isOpen && (
              <div>
                {cos.length === 0 && (leadsByCompany.none || []).length === 0 && (
                  <div className="empty" style={{ padding: 24 }}>No leads yet in this campaign.</div>
                )}
                {cos.map((co) => (
                  <Company key={co.id} name={co.name} leads={leadsByCompany[co.id] || []} onOpenLead={onOpenLead} />
                ))}
                {(leadsByCompany.none || []).length > 0 && (
                  <Company name="(No company)" leads={leadsByCompany.none} onOpenLead={onOpenLead} />
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function Company({ name, leads, onOpenLead }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="company">
      <div className="company-row" onClick={() => setOpen((o) => !o)}>
        <div><strong>{name}</strong> <span className="muted-sm">· {leads.length}</span></div>
        <span className="muted-sm">{open ? '▾' : '▸'}</span>
      </div>
      {open && leads.map((l) => (
        <div className="lead-row" key={l.id} onClick={() => onOpenLead(l.id)}>
          <div>
            <div className="lead-name">{[l.first_name, l.last_name].filter(Boolean).join(' ') || l.email}</div>
            <div className="lead-email">{l.email}</div>
          </div>
          <StatusPill status={l.status} />
        </div>
      ))}
    </div>
  );
}
