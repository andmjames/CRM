// create-lead.js — manual / API lead creation. Enqueues the first cold email.
const { supabase, isSuppressed } = require('./_lib/supabase');
const { json, requireAuth, enqueueColdEmail1 } = require('./_lib/core');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  if (!requireAuth(event)) return json(401, { error: 'unauthorized' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }

  const { campaign_id, first_name, last_name, email, company, samples, source } = payload;
  if (!campaign_id || !email) return json(400, { error: 'campaign_id and email are required' });
  const cleanEmail = String(email).trim().toLowerCase();

  // Suppression + global-uniqueness checks.
  if (await isSuppressed(cleanEmail)) return json(409, { error: 'email is on the Do Not Contact list', code: 'suppressed' });
  const { data: existing } = await supabase.from('leads').select('id, campaign_id').ilike('email', cleanEmail).maybeSingle();
  if (existing) return json(409, { error: 'email already exists in the system', code: 'duplicate', lead_id: existing.id });

  const { data: campaign, error: cErr } = await supabase.from('campaigns').select('*').eq('id', campaign_id).maybeSingle();
  if (cErr || !campaign) return json(404, { error: 'campaign not found' });

  // Upsert company within the campaign.
  let companyId = null;
  if (company && company.trim()) {
    const { data: existingCo } = await supabase.from('companies')
      .select('id').eq('campaign_id', campaign_id).eq('name', company.trim()).maybeSingle();
    if (existingCo) companyId = existingCo.id;
    else {
      const { data: newCo } = await supabase.from('companies')
        .insert({ campaign_id, name: company.trim() }).select('id').maybeSingle();
      companyId = newCo?.id || null;
    }
  }

  const { data: lead, error: lErr } = await supabase.from('leads').insert({
    campaign_id,
    company_id: companyId,
    first_name: first_name || '',
    last_name: last_name || '',
    email: cleanEmail,
    status: 'cold',
    samples: Array.isArray(samples) ? samples : [],
    source: source || 'manual',
  }).select('*').maybeSingle();
  if (lErr) return json(500, { error: lErr.message });

  await enqueueColdEmail1(lead, campaign);

  // Kick the engine so immediate first emails go out promptly (best-effort).
  try {
    const base = process.env.URL || `https://${event.headers.host}`;
    fetch(`${base}/.netlify/functions/engine`).catch(() => {});
  } catch { /* ignore */ }

  return json(200, { lead });
};
