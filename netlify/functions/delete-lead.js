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

  // Note the company before deleting so we can clean it up if it becomes empty.
  const { data: lead } = await supabase.from('leads').select('company_id').eq('id', id).maybeSingle();
  const companyId = lead?.company_id || null;

  // Cancel any pending actions first (defensive — cascade handles deletion too).
  await supabase.from('scheduled_actions').update({ status: 'canceled' }).eq('lead_id', id).eq('status', 'pending');
  const { error } = await supabase.from('leads').delete().eq('id', id);
  if (error) return json(500, { error: error.message });

  // If that was the company's last lead, delete the empty company too.
  let companyDeleted = false;
  if (companyId) {
    const { count } = await supabase.from('leads').select('id', { count: 'exact', head: true }).eq('company_id', companyId);
    if (!count) {
      await supabase.from('companies').delete().eq('id', companyId);
      companyDeleted = true;
    }
  }

  return json(200, { ok: true, deleted: id, companyDeleted });
};

exports.handler = require('./_lib/core').safe(_handler);
