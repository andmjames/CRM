// apollo-import.js — enrich selected prospects (spends 1 credit each) and create
// them as COLD leads in the chosen campaign, entering the cold-email sequence.
// Process small batches (the frontend chunks selections) to stay within the
// function timeout, since each enrichment call takes ~1s.
const { supabase, isSuppressed } = require('./_lib/supabase');
const { json, requireAuth, safe, enqueueColdEmail1 } = require('./_lib/core');
const apollo = require('./_lib/apollo');

const MAX_PER_CALL = 12;
const LOCKED = /(email_not_unlocked|not_unlocked|@domain\.com)/i;

const _handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  if (!requireAuth(event)) return json(401, { error: 'unauthorized' });
  if (!apollo.connected()) return json(400, { code: 'apollo_not_connected', error: 'Apollo is not connected. Add APOLLO_API_KEY in Netlify, then redeploy.' });

  let p; try { p = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }
  const { campaign_id } = p;
  const people = Array.isArray(p.people) ? p.people.slice(0, MAX_PER_CALL) : [];
  if (!campaign_id || !people.length) return json(400, { error: 'campaign_id and people[] required' });

  const { data: campaign } = await supabase.from('campaigns').select('*').eq('id', campaign_id).maybeSingle();
  if (!campaign) return json(404, { error: 'campaign not found' });

  const results = { imported: 0, no_email: 0, duplicates: 0, suppressed: 0, errors: 0, leads: [] };

  for (const person of people) {
    try {
      // Reveal the work email (1 credit).
      let enr = null;
      try {
        const r = await apollo.enrichPerson({
          id: person.apollo_id,
          first_name: person.first_name,
          last_name: person.last_name,
          organization_name: person.company,
          domain: person.domain,
        });
        enr = r && r.person ? r.person : null;
      } catch { enr = null; }

      const email = enr && enr.email ? String(enr.email).trim().toLowerCase() : '';
      if (!email || LOCKED.test(email)) { results.no_email++; continue; }

      if (await isSuppressed(email)) { results.suppressed++; continue; }
      const { data: existing } = await supabase.from('leads').select('id').ilike('email', email).maybeSingle();
      if (existing) { results.duplicates++; continue; }

      const first_name = (enr.first_name || person.first_name || '').trim();
      const last_name = (enr.last_name || person.last_name || '').trim();
      const companyName = (enr.organization_name || (enr.organization && enr.organization.name) || person.company || '').trim();

      let companyId = null;
      if (companyName) {
        const { data: co } = await supabase.from('companies')
          .select('id').eq('campaign_id', campaign_id).eq('name', companyName).maybeSingle();
        if (co) companyId = co.id;
        else {
          const { data: nc } = await supabase.from('companies')
            .insert({ campaign_id, name: companyName }).select('id').maybeSingle();
          companyId = nc?.id || null;
        }
      }

      const { data: lead, error } = await supabase.from('leads').insert({
        campaign_id,
        company_id: companyId,
        first_name,
        last_name,
        email,
        status: 'cold',
        samples: [],
        source: 'apollo',
      }).select('*').maybeSingle();
      if (error || !lead) { results.errors++; continue; }

      await enqueueColdEmail1(lead, campaign);
      results.imported++;
      results.leads.push({ id: lead.id, email, first_name, company: companyName });
    } catch { results.errors++; }
  }

  // Kick the engine so immediate first emails go out promptly (best-effort).
  if (results.imported > 0) {
    try {
      const base = process.env.URL || `https://${event.headers.host}`;
      fetch(`${base}/.netlify/functions/engine`).catch(() => {});
    } catch { /* ignore */ }
  }

  return json(200, results);
};

exports.handler = safe(_handler);
