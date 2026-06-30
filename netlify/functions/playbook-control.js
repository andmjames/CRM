// Reply Playbook run control: start a mining run, report status, pause/resume, delete.
const { supabase } = require('./_lib/supabase');
const { json, requireAuth, safe } = require('./_lib/core');
const gmail = require('./_lib/gmail');

function ymd(d) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${z(d.getMonth() + 1)}/${z(d.getDate())}`;
}

async function statusPayload() {
  const { data: account } = await supabase.from('gmail_token_cache')
    .select('account_email, updated_at').order('updated_at', { ascending: false }).limit(1).maybeSingle();
  const { data: run } = await supabase.from('mining_runs')
    .select('*').order('created_at', { ascending: false }).limit(1).maybeSingle();
  const { data: counts } = await supabase.from('reply_rules').select('status');
  const tally = { suggested: 0, approved: 0, rejected: 0 };
  (counts || []).forEach((r) => { tally[r.status] = (tally[r.status] || 0) + 1; });
  return { connected: !!account, account: account?.account_email || null, run: run || null, ruleCounts: tally };
}

const _handler = async (event) => {
  if (!requireAuth(event)) return json(401, { error: 'unauthorized' });

  if (event.httpMethod === 'GET') return json(200, await statusPayload());

  let p; try { p = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }

  if (p.action === 'start') {
    const account = await gmail.currentAccount();
    if (!account) return json(400, { error: 'Connect Gmail first.' });
    // Block a second concurrent run.
    const { data: active } = await supabase.from('mining_runs')
      .select('id').in('phase', ['fetching', 'extracting']).limit(1).maybeSingle();
    if (active) return json(409, { error: 'A run is already in progress.' });

    const months = Number(p.months) > 0 ? Number(p.months) : 24;
    const to = new Date();
    const from = new Date(); from.setMonth(from.getMonth() - months);
    const beforeExclusive = new Date(to); beforeExclusive.setDate(beforeExclusive.getDate() + 1);
    const repliesOnly = p.replies_only !== false;
    const query = `in:sent after:${ymd(from)} before:${ymd(beforeExclusive)}`;

    const { data: run, error } = await supabase.from('mining_runs').insert({
      account_email: account.account_email,
      date_from: from.toISOString().slice(0, 10),
      date_to: to.toISOString().slice(0, 10),
      gmail_query: query,
      replies_only: repliesOnly,
      phase: 'fetching',
    }).select('*').maybeSingle();
    if (error) return json(500, { error: error.message });

    // Kick the miner so it starts immediately (cron is the backstop).
    try {
      const base = process.env.URL || `https://${event.headers.host}`;
      fetch(`${base}/.netlify/functions/mine-tick`).catch(() => {});
    } catch { /* ignore */ }
    return json(200, { run });
  }

  if (p.action === 'pause' && p.id) {
    await supabase.from('mining_runs').update({ phase: 'paused', updated_at: new Date().toISOString() }).eq('id', p.id);
    return json(200, { ok: true });
  }
  if (p.action === 'resume' && p.id) {
    const { data: run } = await supabase.from('mining_runs').select('page_token').eq('id', p.id).maybeSingle();
    await supabase.from('mining_runs').update({ phase: run?.page_token ? 'fetching' : 'extracting', error: null, updated_at: new Date().toISOString() }).eq('id', p.id);
    try { const base = process.env.URL || `https://${event.headers.host}`; fetch(`${base}/.netlify/functions/mine-tick`).catch(() => {}); } catch { /* ignore */ }
    return json(200, { ok: true });
  }
  if (p.action === 'delete' && p.id) {
    await supabase.from('mining_runs').delete().eq('id', p.id);
    return json(200, { ok: true });
  }

  return json(400, { error: 'unknown action' });
};

exports.handler = safe(_handler);
