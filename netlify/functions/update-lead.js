// update-lead.js — edit a lead's status, notes, samples, pause, intervals.
const { supabase } = require('./_lib/supabase');
const { json, requireAuth } = require('./_lib/core');

const VALID_STATUS = ['cold', 'dialogue', 'current_customer', 'inactive'];

const _handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  if (!requireAuth(event)) return json(401, { error: 'unauthorized' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }
  const { id, status, notes, samples, paused, interval_overrides } = payload;
  if (!id) return json(400, { error: 'id required' });

  const patch = {};
  if (status !== undefined) {
    if (!VALID_STATUS.includes(status)) return json(400, { error: 'invalid status' });
    patch.status = status;
  }
  if (notes !== undefined) patch.notes = notes;
  if (samples !== undefined) patch.samples = Array.isArray(samples) ? samples : [];
  if (paused !== undefined) patch.paused = !!paused;
  if (interval_overrides !== undefined) patch.interval_overrides = interval_overrides;

  const { data: lead, error } = await supabase.from('leads').update(patch).eq('id', id).select('*').maybeSingle();
  if (error) return json(500, { error: error.message });

  // Leaving Cold (or going Inactive/Pause) cancels pending automated SENDS.
  if (status && status !== 'cold') {
    await supabase.from('scheduled_actions')
      .update({ status: 'canceled' })
      .eq('lead_id', id).eq('action_type', 'send').eq('status', 'pending');
  }
  if (status === 'inactive') {
    await supabase.from('scheduled_actions')
      .update({ status: 'canceled' })
      .eq('lead_id', id).in('status', ['pending']);
  }

  // Mirror a status change onto the Front conversation tags (best-effort).
  if (status && lead?.front_conversation_id) {
    require('./_lib/front').syncStatusTag(lead.front_conversation_id, status).catch(() => {});
  }

  return json(200, { lead });
};

exports.handler = require('./_lib/core').safe(_handler);
