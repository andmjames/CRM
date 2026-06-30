import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api';

const CATS = ['pricing', 'samples', 'lead_times', 'logistics', 'tone', 'general'];
const phaseLabel = {
  fetching: 'Reading sent mail…', extracting: 'Learning rules…',
  done: 'Complete', paused: 'Paused', error: 'Error',
};

export default function Playbook({ notify }) {
  const [status, setStatus] = useState(null);
  const [rules, setRules] = useState([]);
  const [months, setMonths] = useState(24);
  const [busy, setBusy] = useState(false);
  const [showApproved, setShowApproved] = useState(false);

  const loadStatus = useCallback(async () => {
    try { setStatus(await api.playbookStatus()); } catch (e) { notify(e.message); }
  }, [notify]);
  const loadRules = useCallback(async () => {
    try { setRules((await api.playbookRules()).rules); } catch (e) { notify(e.message); }
  }, [notify]);

  useEffect(() => { loadStatus(); loadRules(); }, [loadStatus, loadRules]);

  // Poll while a run is active.
  useEffect(() => {
    const active = status?.run && ['fetching', 'extracting'].includes(status.run.phase);
    if (!active) return undefined;
    const t = setInterval(() => { loadStatus(); loadRules(); }, 6000);
    return () => clearInterval(t);
  }, [status, loadStatus, loadRules]);

  async function connectGmail() {
    try { const { url } = await api.gmailAuthUrl(); window.location.href = url; }
    catch (e) { notify(e.message); }
  }
  async function start() {
    setBusy(true);
    try { await api.playbookStart(Number(months), true); notify('Mining started.'); await loadStatus(); }
    catch (e) { notify(e.message); } finally { setBusy(false); }
  }
  async function control(action, id) {
    try { await api.playbookControl(action, id); await loadStatus(); }
    catch (e) { notify(e.message); }
  }
  async function ruleAction(body) {
    try { await api.playbookRuleAction(body); await loadRules(); await loadStatus(); }
    catch (e) { notify(e.message); }
  }
  async function consolidate() {
    setBusy(true);
    try { const r = await api.playbookRuleAction({ action: 'consolidate' }); notify(`Consolidated into ${r.merged} rules.`); await loadRules(); }
    catch (e) { notify(e.message); } finally { setBusy(false); }
  }

  const run = status?.run;
  const suggested = rules.filter((r) => r.status === 'suggested');
  const approved = rules.filter((r) => r.status === 'approved');

  return (
    <>
      <h2 style={{ marginBottom: 4 }}>Email Response Learning</h2>
      <p className="sub" style={{ marginTop: 0 }}>Learns how you respond to emails from your sent mail, then folds the approved rules into how Dialogue replies are drafted.</p>

      {/* Connection + run control */}
      <div className="card card-pad" style={{ marginTop: 12 }}>
        {!status?.connected ? (
          <>
            <p style={{ marginTop: 0 }}>Connect the Gmail account whose sent replies you want to learn from. Read-only access.</p>
            <button className="btn accent" onClick={connectGmail}>Connect Gmail</button>
          </>
        ) : (
          <>
            <div className="row" style={{ alignItems: 'center' }}>
              <div>Connected: <strong>{status.account}</strong></div>
              <div className="spacer" />
              <button className="btn ghost sm" onClick={connectGmail}>Reconnect</button>
            </div>

            {(!run || run.phase === 'done' || run.phase === 'error') && (
              <div className="row" style={{ gap: 12, marginTop: 14, alignItems: 'flex-end' }}>
                <label className="field" style={{ width: 160 }}><span>Look back (months)</span>
                  <input type="number" value={months} onChange={(e) => setMonths(e.target.value)} />
                </label>
                <button className="btn accent" disabled={busy} onClick={start}>Start mining</button>
              </div>
            )}

            {run && (
              <div style={{ marginTop: 14 }}>
                <div className="row" style={{ alignItems: 'center' }}>
                  <strong>{phaseLabel[run.phase] || run.phase}</strong>
                  <div className="spacer" />
                  {['fetching', 'extracting'].includes(run.phase) && <button className="btn ghost sm" onClick={() => control('pause', run.id)}>Pause</button>}
                  {run.phase === 'paused' && <button className="btn ghost sm" onClick={() => control('resume', run.id)}>Resume</button>}
                  {['done', 'error', 'paused'].includes(run.phase) && <button className="btn ghost sm danger" onClick={() => control('delete', run.id)}>Clear</button>}
                </div>
                <div className="muted-sm" style={{ marginTop: 6 }}>
                  {run.total_fetched} emails read · {run.total_replies} replies found · {run.total_processed} analyzed
                </div>
                {run.error && <div className="muted-sm" style={{ color: '#b00', marginTop: 4 }}>{run.error}</div>}
              </div>
            )}
          </>
        )}
      </div>

      {/* Suggested rules */}
      <div className="row" style={{ marginTop: 22, alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>Suggested rules</h2>
        <span className="muted-sm" style={{ marginLeft: 8 }}>{suggested.length}</span>
        <div className="spacer" />
        {suggested.length > 0 && (
          <>
            <button className="btn ghost sm" disabled={busy} onClick={consolidate}>Consolidate</button>
            <button className="btn ghost sm" onClick={() => ruleAction({ action: 'approve_all_suggested' })}>Approve all</button>
          </>
        )}
      </div>
      {suggested.length === 0 && <p className="sub">No suggestions yet. Start mining to generate them.</p>}
      {CATS.map((cat) => {
        const items = suggested.filter((r) => r.category === cat);
        if (!items.length) return null;
        return (
          <div key={cat} style={{ marginTop: 10 }}>
            <div className="section-title" style={{ textTransform: 'capitalize' }}>{cat.replace('_', ' ')}</div>
            {items.map((r) => (
              <div className="card" key={r.id} style={{ padding: '10px 12px', marginBottom: 8 }}>
                <div style={{ fontSize: 14 }}>{r.rule_text}</div>
                {r.example && <div className="muted-sm" style={{ marginTop: 3 }}>{r.example}</div>}
                <div className="row" style={{ marginTop: 8, alignItems: 'center' }}>
                  <span className="muted-sm">seen {r.support_count}×</span>
                  <div className="spacer" />
                  <button className="btn ghost sm" onClick={() => ruleAction({ action: 'set_status', id: r.id, status: 'approved' })}>Approve</button>
                  <button className="btn ghost sm danger" onClick={() => ruleAction({ action: 'set_status', id: r.id, status: 'rejected' })}>Reject</button>
                </div>
              </div>
            ))}
          </div>
        );
      })}

      {/* Approved rules (collapsible) */}
      {approved.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <button
            className="btn ghost"
            onClick={() => setShowApproved((v) => !v)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', textAlign: 'left' }}
          >
            <span>Approved rules <span className="muted-sm">({approved.length})</span> — applied to every Dialogue reply draft</span>
            <span style={{ transform: showApproved ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>▾</span>
          </button>
          {showApproved && (
            <div style={{ marginTop: 10 }}>
              {approved.map((r) => (
                <div className="card" key={r.id} style={{ padding: '10px 12px', marginBottom: 8 }}>
                  <div style={{ fontSize: 14 }}><span className="muted-sm" style={{ textTransform: 'capitalize' }}>[{r.category.replace('_', ' ')}] </span>{r.rule_text}</div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <div className="spacer" />
                    <button className="btn ghost sm" onClick={() => ruleAction({ action: 'set_status', id: r.id, status: 'suggested' })}>Unapprove</button>
                    <button className="btn ghost sm danger" onClick={() => ruleAction({ action: 'delete', id: r.id })}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
