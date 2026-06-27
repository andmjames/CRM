// overview.js — dashboard stats + campaigns -> companies -> leads for the home page.
const { supabase } = require('./_lib/supabase');
const { json, requireAuth } = require('./_lib/core');
const { nowLocal } = require('./_lib/schedule');

const _handler = async (event) => {
  if (!requireAuth(event)) return json(401, { error: 'unauthorized' });

  const [{ data: campaigns }, { data: companies }, { data: leads }] = await Promise.all([
    supabase.from('campaigns').select('*').order('created_at', { ascending: true }),
    supabase.from('companies').select('id, campaign_id, name'),
    supabase.from('leads').select('id, campaign_id, company_id, first_name, last_name, email, status, paused'),
  ]);

  const weekAhead = nowLocal().plus({ days: 7 }).toUTC().toISO();
  const { count: upcomingCount } = await supabase
    .from('scheduled_actions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
    .lte('scheduled_for', weekAhead);

  const byStatus = { cold: 0, dialogue: 0, current_customer: 0, inactive: 0 };
  (leads || []).forEach((l) => { byStatus[l.status] = (byStatus[l.status] || 0) + 1; });

  return json(200, {
    campaigns: campaigns || [],
    companies: companies || [],
    leads: leads || [],
    stats: {
      totalLeads: (leads || []).length,
      byStatus,
      sendsNext7Days: upcomingCount || 0,
    },
  });
};

exports.handler = require('./_lib/core').safe(_handler);
