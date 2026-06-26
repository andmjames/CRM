// get-lead.js — full detail for one lead.
const { supabase } = require('./_lib/supabase');
const { json, requireAuth } = require('./_lib/core');

exports.handler = async (event) => {
  if (!requireAuth(event)) return json(401, { error: 'unauthorized' });
  const id = event.queryStringParameters?.id;
  if (!id) return json(400, { error: 'id required' });

  const { data: lead } = await supabase.from('leads').select('*').eq('id', id).maybeSingle();
  if (!lead) return json(404, { error: 'not found' });

  const [{ data: campaign }, { data: company }, { data: upcoming }, { data: history }] = await Promise.all([
    supabase.from('campaigns').select('*').eq('id', lead.campaign_id).maybeSingle(),
    lead.company_id
      ? supabase.from('companies').select('name').eq('id', lead.company_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('scheduled_actions').select('*')
      .eq('lead_id', id).in('status', ['pending', 'processing'])
      .order('scheduled_for', { ascending: true }),
    supabase.from('scheduled_actions').select('*')
      .eq('lead_id', id).eq('status', 'done')
      .order('executed_at', { ascending: false }),
  ]);

  return json(200, {
    lead,
    campaign: campaign || null,
    companyName: company?.name || null,
    upcoming: upcoming || [],
    history: history || [],
  });
};
