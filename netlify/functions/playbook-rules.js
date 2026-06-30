// Reply Playbook rules: list, approve/reject, bulk-approve, consolidate, delete.
const { supabase } = require('./_lib/supabase');
const { json, requireAuth, safe } = require('./_lib/core');
const { consolidateRules } = require('./_lib/claude');

const _handler = async (event) => {
  if (!requireAuth(event)) return json(401, { error: 'unauthorized' });

  if (event.httpMethod === 'GET') {
    const { data } = await supabase.from('reply_rules')
      .select('*').order('status').order('category').order('support_count', { ascending: false });
    return json(200, { rules: data || [] });
  }

  let p; try { p = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }

  if (p.action === 'set_status' && p.id && ['suggested', 'approved', 'rejected'].includes(p.status)) {
    await supabase.from('reply_rules').update({ status: p.status, updated_at: new Date().toISOString() }).eq('id', p.id);
    return json(200, { ok: true });
  }
  if (p.action === 'edit' && p.id) {
    const patch = { updated_at: new Date().toISOString() };
    if (p.rule_text !== undefined) patch.rule_text = p.rule_text;
    if (p.category !== undefined) patch.category = p.category;
    await supabase.from('reply_rules').update(patch).eq('id', p.id);
    return json(200, { ok: true });
  }
  if (p.action === 'approve_all_suggested') {
    await supabase.from('reply_rules').update({ status: 'approved', updated_at: new Date().toISOString() }).eq('status', 'suggested');
    return json(200, { ok: true });
  }
  if (p.action === 'delete' && p.id) {
    await supabase.from('reply_rules').delete().eq('id', p.id);
    return json(200, { ok: true });
  }
  if (p.action === 'consolidate') {
    // Merge the suggested set into a clean canonical list (approved/rejected untouched).
    const { data: suggested } = await supabase.from('reply_rules').select('category, rule_text, example, support_count').eq('status', 'suggested');
    if (!suggested || suggested.length === 0) return json(200, { ok: true, merged: 0 });
    const input = suggested.map((r) => ({ category: r.category, rule: r.rule_text, example: r.example, support_count: r.support_count }));
    const merged = await consolidateRules(input);
    if (!merged.length) return json(200, { ok: true, merged: 0 });
    await supabase.from('reply_rules').delete().eq('status', 'suggested');
    await supabase.from('reply_rules').insert(merged.map((m) => ({
      category: m.category || 'general', rule_text: m.rule, example: m.example || null,
      support_count: Number(m.support_count) || 1, status: 'suggested',
    })));
    return json(200, { ok: true, merged: merged.length });
  }

  return json(400, { error: 'unknown action' });
};

exports.handler = safe(_handler);
