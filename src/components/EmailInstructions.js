import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api';

const CATS = ['general', 'pricing', 'samples', 'lead_times', 'logistics', 'tone'];

export default function EmailInstructions({ notify }) {
  const [instructions, setInstructions] = useState({});
  const [accounts, setAccounts] = useState([]);
  const [rules, setRules] = useState([]);
  const [scope, setScope] = useState('global');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [showRules, setShowRules] = useState(true);
  const [newRule, setNewRule] = useState('');
  const [newCat, setNewCat] = useState('general');

  const loadRules = useCallback(async () => {
    try { setRules((await api.playbookRules()).rules.filter((r) => r.status === 'approved')); }
    catch (e) { notify(e.message); }
  }, [notify]);

  const load = useCallback(async () => {
    try {
      const r = await api.emailInstructions();
      setInstructions(r.instructions || {});
      setAccounts(r.accounts || []);
    } catch (e) { notify(e.message); }
  }, [notify]);

  useEffect(() => { load(); loadRules(); }, [load, loadRules]);
  useEffect(() => { setText(instructions[scope] || ''); }, [scope, instructions]);

  const scopes = ['global', ...accounts];
  const scopeLabel = (s) => (s === 'global' ? 'Global — all channels' : s);

  const scopeRulesAll = rules.filter((r) => (scope === 'global' ? !r.account_email : r.account_email === scope));
  const scopeRules = scopeRulesAll.filter((r) => {
    const q = search.trim().toLowerCase();
    return !q || r.rule_text.toLowerCase().includes(q) || (r.category || '').includes(q);
  });

  async function saveText() {
    setBusy(true);
    try {
      await api.saveEmailInstructions(scope, text);
      setInstructions({ ...instructions, [scope]: text });
      notify('Instructions saved.');
    } catch (e) { notify(e.message); } finally { setBusy(false); }
  }
  async function addRule() {
    if (!newRule.trim()) return;
    try {
      await api.playbookRuleAction({ action: 'add', rule_text: newRule.trim(), category: newCat, account_email: scope === 'global' ? null : scope });
      setNewRule(''); await loadRules(); notify('Rule added.');
    } catch (e) { notify(e.message); }
  }
  async function delRule(id) {
    try { await api.playbookRuleAction({ action: 'delete', id }); await loadRules(); }
    catch (e) { notify(e.message); }
  }

  return (
    <>
      <h2 style={{ marginBottom: 4 }}>Email Writing Instructions</h2>
      <p className="sub" style={{ marginTop: 0 }}>Guidance for AI-written emails. Global instructions apply everywhere; per-address instructions apply only to that channel. Immediate reply drafts use these instructions plus the rules below.</p>

      <div className="card card-pad" style={{ marginTop: 12 }}>
        <label className="field" style={{ maxWidth: 320 }}><span>Instructions for</span>
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            {scopes.map((s) => <option key={s} value={s}>{scopeLabel(s)}</option>)}
          </select>
        </label>

        <label className="field"><span>{scope === 'global' ? 'Global instructions (every channel)' : `Instructions for ${scope}`}</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 130 }} placeholder="e.g. Always sign off with Thank you very much. Never quote lead times without checking." />
        </label>
        <div className="row"><button className="btn" disabled={busy} onClick={saveText}>Save instructions</button></div>

        <div className="divider" style={{ margin: '18px 0 14px' }} />

        {/* Rules for this scope */}
        <button
          className="btn ghost"
          onClick={() => setShowRules((v) => !v)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', textAlign: 'left' }}
        >
          <span>Rules for {scopeLabel(scope)} <span className="muted-sm">({scopeRules.length})</span></span>
          <span style={{ transform: showRules ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>▾</span>
        </button>

        {showRules && (
          <div style={{ marginTop: 12 }}>
            <input placeholder="Search rules…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: 10 }} />

            {scopeRules.length === 0 && <p className="muted-sm">No rules here yet. Add one below, or approve mined rules in Email Response Learning.</p>}
            {scopeRules.map((r) => (
              <div className="card" key={r.id} style={{ padding: '9px 12px', marginBottom: 7 }}>
                <div style={{ fontSize: 14 }}><span className="muted-sm" style={{ textTransform: 'capitalize' }}>[{(r.category || 'general').replace('_', ' ')}] </span>{r.rule_text}</div>
                <div className="row" style={{ marginTop: 6, alignItems: 'center', gap: 8 }}>
                  <span className="muted-sm">seen {r.support_count}×</span>
                  <div className="spacer" />
                  <button className="btn ghost sm danger" onClick={() => delRule(r.id)}>Delete</button>
                </div>
              </div>
            ))}

            <div className="card" style={{ padding: '10px 12px', marginTop: 10 }}>
              <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
                <label className="field" style={{ width: 150 }}><span>Category</span>
                  <select value={newCat} onChange={(e) => setNewCat(e.target.value)}>
                    {CATS.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
                  </select>
                </label>
                <label className="field" style={{ flex: 1 }}><span>New rule for {scopeLabel(scope)}</span>
                  <input value={newRule} onChange={(e) => setNewRule(e.target.value)} placeholder="e.g. Offer a free sample when they mention testing." />
                </label>
                <button className="btn" onClick={addRule}>Add</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
