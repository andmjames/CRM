const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

async function getSettings() {
  const { data, error } = await supabase.from('settings').select('key, value');
  if (error) throw error;
  const out = {};
  (data || []).forEach((r) => { out[r.key] = r.value; });
  return out;
}

async function isSuppressed(email) {
  const { data } = await supabase
    .from('suppression_list')
    .select('email')
    .eq('email', String(email || '').toLowerCase())
    .maybeSingle();
  return !!data;
}

module.exports = { supabase, getSettings, isSuppressed };
