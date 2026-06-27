import React, { useState, useMemo } from 'react';

const STATUS_LABEL = { cold: 'Cold', dialogue: 'Dialogue', current_customer: 'Current customer', inactive: 'Inactive' };
const STATUS_ORDER = { cold: 0, dialogue: 1, current_customer: 2, inactive: 3 };

function StatusPill({ status }) {
  return <span className={`pill ${status}`}>{STATUS_LABEL[status] || status}</span>;
}

export default function Leads({ data, onOpenLead }) {
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const campaignName = useMemo(() => Object.fromEntries((data.campaigns || []).map((c) => [c.id, c.name])), [data]);
  const companyName = useMemo(() => Object.fromEntries((data.companies || []).map((c) => [c.id, c.name])), [data]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data.leads || [])
      .filter((l) => statusFilter === 'all' || l.status === statusFilter)
      .filter((l) => {
        if (!needle) return true;
        const hay = [
          l.first_name, l.last_name, l.email,
          companyName[l.company_id], campaignName[l.campaign_id],
        ].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(needle);
      })
      .sort((a, b) => {
        const s = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
        if (s !== 0) return s;
        return [a.first_name, a.last_name].join(' ').localeCompare([b.first_name, b.last_name].join(' '));
      });
  }, [data, q, statusFilter, campaignName, companyName]);

  return (
    <>
      <div className="row">
        <h1 style={{ margin: 0 }}>All leads</h1>
        <div className="spacer" />
        <span className="muted-sm">{rows.length} of {(data.leads || []).length}</span>
      </div>

      <div className="row" style={{ gap: 10, margin: '14px 0 16px' }}>
        <input
          autoFocus
          placeholder="Search name, email, company, or campaign…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, minWidth: 220 }}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 180 }}>
          <option value="all">All statuses</option>
          <option value="cold">Cold</option>
          <option value="dialogue">Dialogue</option>
          <option value="current_customer">Current customer</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <div className="card">
        {rows.length === 0 && <div className="empty">No leads match.</div>}
        {rows.map((l, i) => (
          <div
            className="lead-row"
            key={l.id}
            style={{ paddingLeft: 18, borderTop: i === 0 ? 'none' : undefined }}
            onClick={() => onOpenLead(l.id)}
          >
            <div>
              <div className="lead-name">
                {[l.first_name, l.last_name].filter(Boolean).join(' ') || l.email}
                {l.paused && <span className="muted-sm" style={{ marginLeft: 8 }}>· paused</span>}
              </div>
              <div className="lead-email">
                {l.email}
                {companyName[l.company_id] ? ` · ${companyName[l.company_id]}` : ''}
                {campaignName[l.campaign_id] ? ` · ${campaignName[l.campaign_id]}` : ''}
              </div>
            </div>
            <StatusPill status={l.status} />
          </div>
        ))}
      </div>
    </>
  );
}
