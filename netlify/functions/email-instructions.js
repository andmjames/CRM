// Email-writing instructions: global + per-channel-address free text.
const { supabase } = require('./_lib/supabase');
const { json, requireAuth, safe } = require('./_lib/core');

const _handler = async (event) => {
  if (!requireAuth(event)) return json(401, { error: 'unauthorized' });

  if (event.httpMethod === 'GET') {
    const { data: rows } = await supabase.from('email_instructions').select('scope, instructions');
    const instructions = {};
    (rows || []).forEach((r) => { instructions[r.scope] = r.instructions || ''; });
    // The set of channel accounts comes from the campaigns' channel addresses.
    const { data: camps } = await supabase.from('campaigns').select('front_channel_address');
    const accounts = [...new Set((camps || [])
      .map((c) => (c.front_channel_address || '').toLowerCase())
      .filter(Boolean))].sort();
    return json(200, { instructions, accounts });
  }

  let p; try { p = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }
  const scope = String(p.scope || '').toLowerCase().trim();
  if (!scope) return json(400, { error: 'scope required' });
  await supabase.from('email_instructions').upsert({
    scope, instructions: p.instructions || '', updated_at: new Date().toISOString(),
  }, { onConflict: 'scope' });
  return json(200, { ok: true });
};

exports.handler = safe(_handler);
