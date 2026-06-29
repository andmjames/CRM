import React, { useState, useEffect } from 'react';
import { api } from '../api';

const ZONE = 'America/Indiana/Indianapolis';
function fmtWhen(iso) {
  return new Date(iso).toLocaleString('en-US', { timeZone: ZONE, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function typeLabel(t) { return t === 'send' ? 'Email' : t === 'draft' ? 'Draft' : 'Comment'; }

// Per-brand slice colors. Matched by brand/name so order doesn't matter.
const FALLBACK = ['#5b4b8a', '#0f766e', '#a32d2d', '#b8860b'];
function colorForCampaign(c, i) {
  const hay = `${c.brand || ''} ${c.name || ''}`.toLowerCase();
  if (hay.includes('floorbond')) return '#E6A700';      // FloorBond — yellow
  if (hay.includes('tape genie') || hay.includes('tapegenie')) return '#2F9E44'; // Tape Genie — green
  if (hay.includes('deckbond')) return '#6B7280';       // DeckBond — gray
  if (hay.includes('pmi')) return '#2F5D8A';            // PMI — blue
  return FALLBACK[i % FALLBACK.length];
}

function LeadsDonut({ slices, total }) {
  const radius = 70, stroke = 26, cx = 100, cy = 100;
  const C = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <svg viewBox="0 0 200 200" width="190" height="190" role="img" aria-label="Leads by campaign">
      <g transform="rotate(-90 100 100)">
        {total === 0 ? (
          <circle cx={cx} cy={cy} r={radius} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        ) : slices.map((s) => {
          const len = (s.value / total) * C;
          const el = (
            <circle key={s.id} cx={cx} cy={cy} r={radius} fill="none"
              stroke={s.color} strokeWidth={stroke}
              strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} />
          );
          offset += len;
          return el;
        })}
      </g>
      <text x="100" y="96" textAnchor="middle" style={{ fontSize: 30, fontWeight: 700, fill: 'var(--text)' }}>{total}</text>
      <text x="100" y="118" textAnchor="middle" style={{ fontSize: 12, fill: 'var(--text2)' }}>{total === 1 ? 'lead' : 'leads'}</text>
    </svg>
  );
}

export default function Dashboard({ data, onOpenLead, onViewUpcoming, onSelectCampaign }) {
  const { campaigns, leads, stats } = data;
  const [upcoming, setUpcoming] = useState(null);

  useEffect(() => {
    let alive = true;
    api.upcoming().then((r) => { if (alive) setUpcoming(r.upcoming); }).catch(() => { if (alive) setUpcoming([]); });
    return () => { alive = false; };
  }, []);

  const countByCampaign = {};
  leads.forEach((l) => { countByCampaign[l.campaign_id] = (countByCampaign[l.campaign_id] || 0) + 1; });

  const campaignCounts = campaigns.map((c, i) => ({
    id: c.id, label: c.name, value: countByCampaign[c.id] || 0, color: colorForCampaign(c, i),
  }));
  const pieSlices = campaignCounts.filter((s) => s.value > 0);
  const totalLeads = campaignCounts.reduce((s, x) => s + x.value, 0);

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
      </div>

      {/* Leads by campaign */}
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <p className="section-title" style={{ marginTop: 0, marginBottom: 14 }}>Leads by campaign</p>
        <div style={{ display: 'flex', gap: 28, alignItems: 'center', flexWrap: 'wrap' }}>
          <LeadsDonut slices={pieSlices} total={totalLeads} />
          <div style={{ flex: 1, minWidth: 220 }}>
            {campaignCounts.map((s) => (
              <div
                key={s.id}
                className="legend-row"
                onClick={() => onSelectCampaign && onSelectCampaign(s.id)}
                title={`View ${s.label} leads`}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px', margin: '0 -8px', borderRadius: 6, cursor: 'pointer' }}
              >
                <span style={{ width: 12, height: 12, borderRadius: 3, background: s.value > 0 ? s.color : 'var(--border)', flex: '0 0 auto' }} />
                <span style={{ flex: 1, fontWeight: 500 }}>{s.label}</span>
                <span className="muted-sm">{s.value} {s.value === 1 ? 'lead' : 'leads'}</span>
                <span className="muted-sm" aria-hidden="true">›</span>
              </div>
            ))}
            {totalLeads === 0 && (
              <div className="muted-sm" style={{ paddingTop: 10 }}>No leads yet. Add or import leads to get started.</div>
            )}
          </div>
        </div>
      </div>

      {/* Upcoming automatic actions */}
      <div className="card card-pad">
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
                  {a.subject || a.generated_body || (a.action_type === 'draft' ? 'Written from the conversation on this date' : a.action_type === 'comment' ? 'Reminder posts on this date' : 'Generated when scheduled')}
                  {a.campaign?.name ? ` · ${a.campaign.name}` : ''}
                </div>
              </div>
              <span className="muted-sm" style={{ whiteSpace: 'nowrap', marginLeft: 12 }}>{fmtWhen(a.scheduled_for)}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
