// update-action.js — edit/preview-edit or cancel a single pending scheduled action.
// Editing a lead's upcoming email here only affects that lead (per-lead override).
const { supabase } = require('./_lib/supabase');
const { json, requireAuth } = require('./_lib/core');
const { rollForward, nowLocal, DateTime, ZONE } = require('./_lib/schedule');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  if (!requireAuth(event)) return json(401, { error: 'unauthorized' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }
  const { id, subject, body, scheduled_for_date, cancel } = payload;
  if (!id) return json(400, { error: 'id required' });

  if (cancel) {
    await supabase.from('scheduled_actions').update({ status: 'canceled' }).eq('id', id).eq('status', 'pending');
    return json(200, { ok: true, canceled: true });
  }

  const patch = { is_override: true };
  if (subject !== undefined) patch.subject = subject;
  if (body !== undefined) patch.generated_body = body;
  if (scheduled_for_date) {
    // Interpret the date as 8am local, then roll forward to a valid business day.
    const dt = DateTime.fromISO(scheduled_for_date, { zone: ZONE }).set({ hour: 8 });
    patch.scheduled_for = rollForward(dt).toUTC().toISO();
  }

  const { data, error } = await supabase.from('scheduled_actions')
    .update(patch).eq('id', id).eq('status', 'pending').select('*').maybeSingle();
  if (error) return json(500, { error: error.message });
  if (!data) return json(409, { error: 'action not editable (already sent or canceled)' });
  return json(200, { action: data });
};
