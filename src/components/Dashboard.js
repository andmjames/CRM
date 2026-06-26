import React, { useState } from 'react';

const STATUS_LABEL = {
  cold: 'Cold', dialogue: 'Dialogue', current_customer: 'Current customer', inactive: 'Inactive',
};

function StatusPill({ status }) {
  return (
    <span className={`pill ${status}`}><span className="dot" />{STATUS_LABEL[status] || status}</span>
  );
}

export default function Dashboard({ data, onOpenLead, onManage }) {
  const { campaigns, companies, leads, stats } = data;
  const [open, setOpen] = useState(() => (campaigns[0] ? { [campaigns[0].id]: true } : {}));

  const leadsByCampaign = {};
  leads.forEach((l) => { (leadsByCampaign[l.campaign_id] ||= []).push(l); });
  const companiesByCampaign = {};
  companies.forEach((c) => { (companiesByCampaign[c.campaign_id] ||= []).push(c); });

  return (
    <>
      <h1>Outreach dashboard</h1>
      <p className="sub" style={{ marginBottom: 20 }}>Every campaign reaches out and follows up on its own. You handle the replies.</p>

      <div className="stat-grid">
        <div className="stat"><div className="n">{stats.totalLeads}</div><div className="l">Total leads</div></div>
        <div className="stat"><div className="n" style={{ color: 'var(--cold)' }}>{stats.byStatus.cold || 0}</div><div className="l">Cold</div></div>
        <div className="stat"><div className="n" style={{ color: 'var(--dialogue)' }}>{stats.byStatus.dialogue || 0}</div><div className="l">In dialogue</div></div>
        <div className="stat"><div className="n" style={{ color: 'var(--current)' }}>{stats.byStatus.current_customer || 0}</div><div className="l">Current customers</div></div>
        <div className="stat"><div className="n" style={{ color: 'var(--success)' }}>{stats.sendsNext7Days}</div><div className="l">Sends next 7 days</div></div>
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

      <div className="manage-link">
        <button onClick={onManage}>Manage campaigns</button>
      </div>
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
