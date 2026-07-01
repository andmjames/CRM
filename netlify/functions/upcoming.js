// upcoming.js — every pending scheduled action across all leads, for the global
// "Upcoming emails" view. Embeds recipient + campaign via PostgREST foreign keys.
const { supabase } = require('./_lib/supabase');
const { json, requireAuth } = require('./_lib/core');

const _handler = async (event) => {
  if (!requireAuth(event)) return json(401, { error: 'unauthorized' });

  const { data, error } = await supabase
    .from('scheduled_actions')
    .select('id, action_type, step, scheduled_for, subject, generated_body, is_override, lead_id, front_conversation_id, label, ' +
            'lead:leads(first_name,last_name,email,status,paused), campaign:campaigns(name)')
    .eq('status', 'pending')
    .order('scheduled_for', { ascending: true });

  if (error) return json(500, { error: error.message });
  return json(200, { upcoming: data || [] });
};

exports.handler = require('./_lib/core').safe(_handler);
