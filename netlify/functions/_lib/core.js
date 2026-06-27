const { supabase, getSettings } = require('./supabase');
const { nowLocal, rollForward, DateTime } = require('./schedule');
const { generateColdFollowup } = require('./claude');

// ---- HTTP helpers ----
function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  };
}

// Token gate. Engine (scheduled) runs without an event token, so allow when
// event is null/cron. Browser calls must send x-access-token.
function requireAuth(event) {
  const expected = process.env.APP_ACCESS_TOKEN;
  if (!expected) return true; // not configured yet
  const got = event?.headers?.['x-access-token'] || event?.headers?.['X-Access-Token'];
  return got === expected;
}

// The four print-shop samples that collectively read as "Screen Tape".
const SCREEN_TAPE_GROUP = ['Split Tape', 'Full Adhesive Tape', 'Quick Rip Tape', 'RED Tape'];

function humanJoin(arr) {
  if (arr.length <= 1) return arr.join('');
  if (arr.length === 2) return `${arr[0]} and ${arr[1]}`;
  return `${arr.slice(0, -1).join(', ')} and ${arr[arr.length - 1]}`;
}

// Collapse the full screen-tape set into "Screen Tape"; list everything else
// (PalletGel, Dual-Tack Pallet Tape, etc.) separately.
function summarizeSamples(samples) {
  const list = (samples || []).map((s) => String(s).trim()).filter(Boolean);
  if (!list.length) return 'samples';
  const set = new Set(list);
  const hasAllScreen = SCREEN_TAPE_GROUP.every((s) => set.has(s));
  let out;
  if (hasAllScreen) {
    out = ['Screen Tape', ...list.filter((s) => !SCREEN_TAPE_GROUP.includes(s))];
  } else {
    out = list;
  }
  return humanJoin(out);
}

function fillTemplate(body, lead) {
  return (body || '')
    .replace(/FIRST_NAME/g, lead.first_name || 'there')
    .replace(/SAMPLES/g, summarizeSamples(lead.samples));
}

// Whether to restrict sends to weekdays/non-holidays/window. Defaults to true
// when the setting is absent; only an explicit 'false' turns it off.
function businessDaysOnly(settings) {
  return (settings.business_days_only ?? 'true') !== 'false';
}

// Find the next staggered send time on a channel so bulk sends don't fire at once.
async function nextStaggeredSlot(channelAddress, settings) {
  const minGap = Number(settings.stagger_seconds_min || 60);
  const maxGap = Number(settings.stagger_seconds_max || 120);
  const start = Number(settings.send_window_start_hour || 8);
  const end = Number(settings.send_window_end_hour || 16);

  const horizon = nowLocal().plus({ hours: 6 }).toUTC().toISO();
  const { data } = await supabase
    .from('scheduled_actions')
    .select('scheduled_for')
    .eq('action_type', 'send')
    .eq('channel_address', channelAddress)
    .eq('status', 'pending')
    .gte('scheduled_for', nowLocal().toUTC().toISO())
    .lte('scheduled_for', horizon)
    .order('scheduled_for', { ascending: false })
    .limit(1);

  let base = nowLocal();
  if (data && data[0]) {
    const last = DateTime.fromISO(data[0].scheduled_for).setZone('America/Indiana/Indianapolis');
    const gap = Math.floor(Math.random() * (maxGap - minGap + 1)) + minGap;
    const candidate = last.plus({ seconds: gap });
    if (candidate > base) base = candidate;
  }
  return rollForward(base, start, end, businessDaysOnly(settings));
}

// Enqueue the first cold email for a freshly created lead.
async function enqueueColdEmail1(lead, campaign) {
  const settings = await getSettings();
  const start = Number(settings.send_window_start_hour || 8);
  const end = Number(settings.send_window_end_hour || 16);

  const { data: tpl } = await supabase
    .from('templates')
    .select('subject, body')
    .eq('campaign_id', campaign.id)
    .eq('step', 1)
    .maybeSingle();

  let scheduledFor;
  if (campaign.first_email_mode === 'immediate') {
    scheduledFor = await nextStaggeredSlot(campaign.front_channel_address, settings);
  } else {
    const weeks = Number(campaign.first_email_weeks || 0);
    scheduledFor = rollForward(nowLocal().plus({ weeks }), start, end, businessDaysOnly(settings));
  }

  await supabase.from('scheduled_actions').insert({
    lead_id: lead.id,
    campaign_id: campaign.id,
    action_type: 'send',
    step: 1,
    scheduled_for: scheduledFor.toUTC().toISO(),
    subject: tpl?.subject || '',
    generated_body: fillTemplate(tpl?.body || 'Hello FIRST_NAME,', lead),
    channel_address: campaign.front_channel_address,
  });
}

// After cold email N sends, generate + enqueue email N+1 (until the cap).
// Keeps one previewable pending email queued per active cold lead.
async function enqueueNextColdEmail({ lead, campaign, justSentStep }) {
  const nextStep = justSentStep + 1;
  if (nextStep > campaign.max_emails) return; // hard cap reached
  const followups = campaign.followup_weeks || [];
  // followup_weeks[0] = weeks after email 1, etc.
  const weeks = followups[nextStep - 2];
  if (weeks == null) return;

  // Pull prior emails for context.
  const { data: prior } = await supabase
    .from('scheduled_actions')
    .select('step, subject, generated_body')
    .eq('lead_id', lead.id)
    .eq('action_type', 'send')
    .lte('step', justSentStep)
    .order('step', { ascending: true });

  const settings = await getSettings();
  const globalCorrections = settings.global_style_corrections || '';

  let gen;
  try {
    gen = await generateColdFollowup({
      campaign,
      lead,
      priorEmails: (prior || []).map((p) => ({ subject: p.subject, body: p.generated_body })),
      styleGuide: campaign.style_guide,
      globalCorrections,
      stepNumber: nextStep,
    });
  } catch (e) {
    gen = { subject: `Following up`, body: `Hello ${lead.first_name || 'there'}, just following up. — Andrew` };
  }

  const start = Number(settings.send_window_start_hour || 8);
  const end = Number(settings.send_window_end_hour || 16);
  const overrides = (lead.interval_overrides && lead.interval_overrides.followup_weeks) || null;
  const useWeeks = overrides && overrides[nextStep - 2] != null ? overrides[nextStep - 2] : weeks;
  const scheduledFor = rollForward(nowLocal().plus({ weeks: useWeeks }), start, end, businessDaysOnly(settings));

  await supabase.from('scheduled_actions').insert({
    lead_id: lead.id,
    campaign_id: campaign.id,
    action_type: 'send',
    step: nextStep,
    scheduled_for: scheduledFor.toUTC().toISO(),
    subject: gen.subject || 'Following up',
    generated_body: gen.body || '',
    channel_address: campaign.front_channel_address,
  });
}

// Wrap a handler so any thrown error becomes a readable JSON 500 instead of a 502.
function safe(handler) {
  return async (event, context) => {
    try {
      return await handler(event, context);
    } catch (e) {
      return json(500, { error: e && e.message ? e.message : String(e) });
    }
  };
}

module.exports = {
  json,
  safe,
  requireAuth,
  fillTemplate,
  nextStaggeredSlot,
  enqueueColdEmail1,
  enqueueNextColdEmail,
};
