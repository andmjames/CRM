const { createClient } = require('@supabase/supabase-js');
// Supply a WebSocket implementation so supabase-js's Realtime client works on
// Node < 22 (which lacks a native global WebSocket). We don't use Realtime, but
// the client constructs it regardless, so this prevents a hard startup error.
let WS = null;
try { WS = require('ws'); } catch { /* ws optional; native WebSocket used if present */ }

// Lazily create the client so a missing env var produces a clear, catchable
// error at request time instead of crashing the whole function at import (502).
let _client = null;
function getClient() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [!url && 'SUPABASE_URL', !key && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean);
  if (missing.length) {
    throw new Error(`Missing environment variable(s): ${missing.join(', ')}. Set them in Netlify -> Site configuration -> Environment variables, then redeploy.`);
  }
  _client = createClient(url, key, {
    auth: { persistSession: false },
    realtime: WS ? { transport: WS } : undefined,
  });
  return _client;
}

// Proxy keeps the familiar `supabase.from(...)` call sites working everywhere,
// but defers initialization until first use (inside a try/catch-able handler).
const supabase = new Proxy({}, {
  get(_t, prop) {
    const client = getClient();
    const v = client[prop];
    return typeof v === 'function' ? v.bind(client) : v;
  },
});

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
