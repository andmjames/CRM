// import-leads.js — bulk create cold leads from spreadsheet rows.
// Dedupes against existing emails + suppression list (in memory), upserts
// companies, inserts leads, and queues Email 1 with staggered send times.
const { supabase, getSettings } = require('./_lib/supabase');
const { json, requireAuth, fillTemplate } = require('./_lib/core');
const { nowLocal, rollForward } = require('./_lib/schedule');

const _handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  if (!requireAuth(event)) return json(401, { error: 'unauthorized' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }
  const { campaign_id, rows } = payload;
  if (!campaign_id || !Array.isArray(rows)) return json(400, { error: 'campaign_id and rows[] required' });
  if (rows.length > 2000) return json(400, { error: 'Please import 2000 rows or fewer at a time.' });

  const { data: campaign } = await supabase.from('campaigns').select('*').eq('id', campaign_id).maybeSingle();
  if (!campaign) return json(404, { error: 'campaign not found' });

  const settings = await getSettings();
  const start = Number(settings.send_window_start_hour || 8);
  const end = Number(settings.send_window_end_hour || 16);
  const minGap = Number(settings.stagger_seconds_min || 60);
  const maxGap = Number(settings.stagger_seconds_max || 120);
  const businessDaysOnly = (settings.business_days_only ?? 'true') !== 'false';

  const { data: tpl } = await supabase.from('templates')
    .select('subject, body').eq('campaign_id', campaign_id).eq('step', 1).maybeSingle();

  // Preload dedupe sets + companies (cheap vs. per-row queries).
  const [{ data: existing }, { data: suppressed }, { data: comps }] = await Promise.all([
    supabase.from('leads').select('email'),
    supabase.from('suppression_list').select('email'),
    supabase.from('companies').select('id, name').eq('campaign_id', campaign_id),
  ]);
  const have = new Set((existing || []).map((r) => r.email.toLowerCase()));
  const blocked = new Set((suppressed || []).map((r) => r.email.toLowerCase()));
  const companyMap = new Map((comps || []).map((c) => [c.name.trim().toLowerCase(), c.id]));

  const isImmediate = campaign.first_email_mode === 'immediate';
  const firstWeeks = Number(campaign.first_email_weeks || 0);
  let cumulativeSeconds = 0;

  const created = [];
  const skipped = [];

  for (const raw of rows) {
    const email = String(raw.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) { skipped.push({ email: raw.email || '(blank)', reason: 'invalid email' }); continue; }
    if (blocked.has(email)) { skipped.push({ email, reason: 'do not contact' }); continue; }
    if (have.has(email)) { skipped.push({ email, reason: 'already in system' }); continue; }

    // Company upsert (cached).
    let companyId = null;
    const coName = String(raw.company || '').trim();
    if (coName) {
      const key = coName.toLowerCase();
      if (companyMap.has(key)) companyId = companyMap.get(key);
      else {
        const { data: newCo } = await supabase.from('companies')
          .insert({ campaign_id, name: coName }).select('id').maybeSingle();
        companyId = newCo?.id || null;
        if (companyId) companyMap.set(key, companyId);
      }
    }

    const samples = campaign.samples_enabled && Array.isArray(raw.samples) ? raw.samples : [];
    const { data: lead, error: lErr } = await supabase.from('leads').insert({
      campaign_id,
      company_id: companyId,
      first_name: String(raw.first_name || '').trim(),
      last_name: String(raw.last_name || '').trim(),
      email,
      status: 'cold',
      samples,
      source: 'spreadsheet',
    }).select('*').maybeSingle();
    if (lErr || !lead) { skipped.push({ email, reason: 'insert failed' }); continue; }

    have.add(email);

    // Schedule Email 1.
    let when;
    if (isImmediate) {
      when = rollForward(nowLocal().plus({ seconds: cumulativeSeconds }), start, end, businessDaysOnly);
      cumulativeSeconds += Math.floor(Math.random() * (maxGap - minGap + 1)) + minGap;
    } else {
      when = rollForward(nowLocal().plus({ weeks: firstWeeks }), start, end, businessDaysOnly);
    }
    await supabase.from('scheduled_actions').insert({
      lead_id: lead.id,
      campaign_id,
      action_type: 'send',
      step: 1,
      scheduled_for: when.toUTC().toISO(),
      subject: tpl?.subject || '',
      generated_body: fillTemplate(tpl?.body || 'GREETING FIRST_NAME,', lead, when.toUTC().toISO()),
      channel_address: campaign.front_channel_address,
    });
    created.push(email);
  }

  // Nudge the engine so immediate sends start promptly.
  try {
    const base = process.env.URL || `https://${event.headers.host}`;
    fetch(`${base}/.netlify/functions/engine`).catch(() => {});
  } catch { /* ignore */ }

  return json(200, { created: created.length, skipped, total: rows.length });
};

exports.handler = require('./_lib/core').safe(_handler);
