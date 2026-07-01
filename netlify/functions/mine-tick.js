// mine-tick.js — advances the active mining run a bounded step at a time.
// Runs on a schedule (see netlify.toml) and is also kicked when a run starts.
// Phase 'fetching': page through sent mail into mined_emails.
// Phase 'extracting': batch unprocessed replies through Claude into reply_rules.
const { supabase } = require('./_lib/supabase');
const { safe, json } = require('./_lib/core');
const { extractReplyRules } = require('./_lib/claude');
const gmail = require('./_lib/gmail');

const FETCH_PER_TICK = 20;   // message bodies fetched per tick
const EXTRACT_PER_TICK = 10; // emails summarized per tick
const CLAUDE_CONCURRENCY = 5;

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

async function runConcurrent(items, n, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += n) {
    out.push(...await Promise.all(items.slice(i, i + n).map(fn)));
  }
  return out;
}

// Insert a candidate rule, or bump support_count if an equivalent one exists
// (deduped within the same account).
async function mergeRule({ category, rule, example }, accountEmail) {
  const cat = ['pricing', 'samples', 'lead_times', 'logistics', 'tone', 'general'].includes(category) ? category : 'general';
  const text = String(rule || '').trim();
  if (!text) return;
  let q = supabase.from('reply_rules')
    .select('id, rule_text, support_count').eq('category', cat).neq('status', 'rejected');
  q = accountEmail ? q.eq('account_email', accountEmail) : q.is('account_email', null);
  const { data: existing } = await q;
  const hit = (existing || []).find((r) => norm(r.rule_text) === norm(text));
  if (hit) {
    await supabase.from('reply_rules').update({ support_count: (hit.support_count || 1) + 1, updated_at: new Date().toISOString() }).eq('id', hit.id);
  } else {
    await supabase.from('reply_rules').insert({ category: cat, rule_text: text, example: example || null, status: 'suggested', account_email: accountEmail || null });
  }
}

async function doFetch(run, token) {
  const { ids, nextPageToken } = await gmail.listSent(token, run.gmail_query, run.page_token);
  let unstored = ids;
  if (ids.length) {
    const { data: have } = await supabase.from('mined_emails').select('gmail_id').in('gmail_id', ids);
    const haveSet = new Set((have || []).map((r) => r.gmail_id));
    unstored = ids.filter((id) => !haveSet.has(id));
  }
  const todo = unstored.slice(0, FETCH_PER_TICK);

  let fetched = 0, replies = 0;
  for (const id of todo) {
    try {
      const msg = await gmail.getMessage(token, id);
      const { error } = await supabase.from('mined_emails').insert({
        run_id: run.id, gmail_id: msg.gmail_id, thread_id: msg.thread_id, sent_at: msg.sent_at,
        to_domains: msg.to_domains, subject: msg.subject, body_text: msg.body_text, is_reply: msg.is_reply,
      });
      if (!error) { fetched += 1; if (msg.is_reply) replies += 1; }
    } catch { /* skip individual message errors */ }
  }

  const patch = {
    total_fetched: (run.total_fetched || 0) + fetched,
    total_replies: (run.total_replies || 0) + replies,
    updated_at: new Date().toISOString(),
  };
  // Advance only when this page is fully stored.
  if (unstored.length <= FETCH_PER_TICK) {
    if (nextPageToken) patch.page_token = nextPageToken;
    else { patch.page_token = null; patch.phase = 'extracting'; }
  }
  await supabase.from('mining_runs').update(patch).eq('id', run.id);
  return { fetched, replies };
}

async function doExtract(run) {
  const { data: batch } = await supabase.from('mined_emails')
    .select('id, subject, body_text')
    .eq('run_id', run.id).eq('processed', false).eq('is_reply', true)
    .limit(EXTRACT_PER_TICK);

  if (!batch || batch.length === 0) {
    // No replies left to process — mark any leftover non-replies done and finish.
    await supabase.from('mined_emails').update({ processed: true }).eq('run_id', run.id).eq('processed', false);
    await supabase.from('mining_runs').update({ phase: 'done', updated_at: new Date().toISOString() }).eq('id', run.id);
    return { processed: 0, done: true };
  }

  const results = await runConcurrent(batch, CLAUDE_CONCURRENCY, async (em) => {
    try { return { id: em.id, rules: await extractReplyRules({ subject: em.subject, body: em.body_text }) }; }
    catch { return { id: em.id, rules: [] }; }
  });

  for (const r of results) {
    for (const rule of (r.rules || []).slice(0, 3)) await mergeRule(rule, run.account_email);
    await supabase.from('mined_emails').update({ processed: true }).eq('id', r.id);
  }
  await supabase.from('mining_runs').update({
    total_processed: (run.total_processed || 0) + batch.length, updated_at: new Date().toISOString(),
  }).eq('id', run.id);
  return { processed: batch.length, done: false };
}

const _handler = async () => {
  const { data: run } = await supabase.from('mining_runs')
    .select('*').in('phase', ['fetching', 'extracting'])
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!run) return json(200, { idle: true });

  try {
    let result;
    if (run.phase === 'fetching') {
      const { token } = await gmail.getAccessToken(run.account_email);
      result = await doFetch(run, token);
    } else {
      result = await doExtract(run);
    }
    return json(200, { run_id: run.id, phase: run.phase, ...result });
  } catch (e) {
    await supabase.from('mining_runs').update({ error: String(e.message).slice(0, 500), updated_at: new Date().toISOString() }).eq('id', run.id);
    return json(200, { run_id: run.id, error: e.message });
  }
};

exports.handler = safe(_handler);
