// settings.js — global style corrections + send window.
const { supabase, getSettings } = require('./_lib/supabase');
const { json, requireAuth } = require('./_lib/core');

exports.handler = async (event) => {
  if (!requireAuth(event)) return json(401, { error: 'unauthorized' });

  if (event.httpMethod === 'GET') {
    return json(200, { settings: await getSettings() });
  }
  if (event.httpMethod === 'POST') {
    let p;
    try { p = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }
    const rows = Object.entries(p).map(([key, value]) => ({ key, value: String(value) }));
    if (!rows.length) return json(400, { error: 'no settings provided' });
    const { error } = await supabase.from('settings').upsert(rows, { onConflict: 'key' });
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true });
  }
  return json(405, { error: 'method not allowed' });
};
