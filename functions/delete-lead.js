// delete-lead.js — permanently delete a lead. Cascades its scheduled_actions
// (FK on delete cascade); sent_log rows are kept with lead_id set null for audit.
const { supabase } = require('./_lib/supabase');
const { json, requireAuth } = require('./_lib/core');

const _handler = async (event) => {
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'DELETE') return json(405, { error: 'POST or DELETE only' });
  if (!requireAuth(event)) return json(401, { error: 'unauthorized' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }
  const { id } = payload;
  if (!id) return json(400, { error: 'id required' });

  // Cancel any pending actions first (defensive — cascade handles deletion too).
  await supabase.from('scheduled_actions').update({ status: 'canceled' }).eq('lead_id', id).eq('status', 'pending');
  const { error } = await supabase.from('leads').delete().eq('id', id);
  if (error) return json(500, { error: error.message });
  return json(200, { ok: true, deleted: id });
};

exports.handler = require('./_lib/core').safe(_handler);
