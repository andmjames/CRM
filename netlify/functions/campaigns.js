// campaigns.js — Manage Campaigns + template/style/interval editing.
const { supabase } = require('./_lib/supabase');
const { json, requireAuth } = require('./_lib/core');

const _handler = async (event) => {
  if (!requireAuth(event)) return json(401, { error: 'unauthorized' });
  const method = event.httpMethod;

  if (method === 'GET') {
    const { data: campaigns } = await supabase.from('campaigns').select('*').order('created_at');
    const { data: templates } = await supabase.from('templates').select('*').eq('step', 1);
    return json(200, { campaigns: campaigns || [], templates: templates || [] });
  }

  let p;
  try { p = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }

  if (method === 'POST') {
    // Create
    const { data, error } = await supabase.from('campaigns').insert({
      name: p.name,
      brand: p.brand || p.name,
      front_channel_address: p.front_channel_address,
      audience_type: p.audience_type || 'retailers',
      product_info: p.product_info || '',
      style_guide: p.style_guide || '',
      first_email_mode: p.first_email_mode || 'immediate',
      first_email_weeks: p.first_email_weeks || 0,
      followup_weeks: p.followup_weeks || [],
      max_emails: p.max_emails || 12,
      samples_enabled: !!p.samples_enabled,
    }).select('*').maybeSingle();
    if (error) return json(500, { error: error.message });
    await supabase.from('templates').insert({
      campaign_id: data.id, step: 1, subject: p.subject || '', body: p.body || 'GREETING FIRST_NAME,',
    });
    return json(200, { campaign: data });
  }

  if (method === 'PUT') {
    // Update campaign + its seed template
    if (!p.id) return json(400, { error: 'id required' });
    const fields = ['name', 'brand', 'front_channel_address', 'audience_type', 'product_info',
      'style_guide', 'first_email_mode', 'first_email_weeks', 'followup_weeks', 'max_emails',
      'samples_enabled', 'active'];
    const patch = {};
    fields.forEach((f) => { if (p[f] !== undefined) patch[f] = p[f]; });
    const { error } = await supabase.from('campaigns').update(patch).eq('id', p.id);
    if (error) return json(500, { error: error.message });
    if (p.subject !== undefined || p.body !== undefined) {
      await supabase.from('templates')
        .upsert({ campaign_id: p.id, step: 1, subject: p.subject || '', body: p.body || '' },
          { onConflict: 'campaign_id,step' });
    }
    return json(200, { ok: true });
  }

  if (method === 'DELETE') {
    if (!p.id) return json(400, { error: 'id required' });
    const { error } = await supabase.from('campaigns').delete().eq('id', p.id);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true });
  }

  return json(405, { error: 'method not allowed' });
};

exports.handler = require('./_lib/core').safe(_handler);
