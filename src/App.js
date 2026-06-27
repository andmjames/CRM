import React, { useState, useEffect, useCallback } from 'react';
import { api } from './api';
import { LOGO_SRC } from './logo';
import Dashboard from './components/Dashboard';
import Leads from './components/Leads';
import UpcomingEmails from './components/UpcomingEmails';
import LeadDetail from './components/LeadDetail';
import SettingsPanel from './components/SettingsPanel';
import AddLeadModal from './components/AddLeadModal';

export default function App() {
  const [view, setView] = useState('home'); // home | leads | upcoming | settings
  const [leadId, setLeadId] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [adding, setAdding] = useState(false);

  const notify = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await api.overview()); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openLead(id) { setLeadId(id); }
  function go(v) { setLeadId(null); setView(v); }

  const tab = (key, label) => (
    <button className={view === key && !leadId ? 'active' : ''} onClick={() => go(key)}>{label}</button>
  );

  return (
    <>
      <header className="app-header">
        <img src={LOGO_SRC} alt="PMI Tape" className="header-logo" />
        <span className="header-divider" />
        <span className="header-page-title">CRM</span>
        <nav>
          {tab('home', 'Dashboard')}
          {tab('leads', 'Leads')}
          {tab('upcoming', 'Upcoming')}
          {tab('settings', 'Settings')}
        </nav>
        <div className="spacer" />
        <button className="btn accent sm" onClick={() => setAdding(true)}>+ Add lead</button>
      </header>

      <div className="container">
        {loading && <div className="empty">Loading…</div>}
        {error && <div className="empty">Couldn't load data: {error}</div>}

        {!loading && !error && (
          leadId ? (
            <LeadDetail
              id={leadId}
              onBack={() => setLeadId(null)}
              onChanged={() => { load(); }}
              onDeleted={() => { setLeadId(null); load(); notify('Lead deleted.'); }}
              notify={notify}
            />
          ) : view === 'home' ? (
            <Dashboard data={data} onOpenLead={openLead} onViewUpcoming={() => go('upcoming')} />
          ) : view === 'leads' ? (
            <Leads data={data} onOpenLead={openLead} />
          ) : view === 'upcoming' ? (
            <UpcomingEmails onOpenLead={openLead} notify={notify} />
          ) : (
            <SettingsPanel notify={notify} onChanged={load} />
          )
        )}
      </div>

      {adding && (
        <AddLeadModal
          campaigns={data?.campaigns || []}
          onClose={() => setAdding(false)}
          onCreated={() => { setAdding(false); load(); notify('Lead added — first email queued.'); }}
          notify={notify}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
