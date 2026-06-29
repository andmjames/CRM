// engine.js — runs every 5 minutes (see netlify.toml).
// Finds due scheduled_actions, performs them via Front, logs them idempotently,
// and chains the next cold email.
const { supabase } = require('./_lib/supabase');
const { nowLocal } = require('./_lib/schedule');
const { enqueueNextColdEmail } = require('./_lib/core');
const { generateReply } = require('./_lib/claude');
const front = require('./_lib/front');

const MAX_PER_RUN = 25; // safety cap per invocation

// Atomically claim an action so overlapping runs can't double-send.
async function claim(actionId) {
  const { data } = await supabase
    .from('scheduled_actions')
    .update({ status: 'processing' })
    .eq('id', actionId)
    .eq('status', 'pending')
    .select()
    .maybeSingle();
  return data; // null if someone else claimed it
}

async function perform(action) {
  const { data: lead } = await supabase.from('leads').select('*').eq('id', action.lead_id).maybeSingle();
  const { data: campaign } = await supabase.from('campaigns').select('*').eq('id', action.campaign_id).maybeSingle();
  if (!lead || !campaign) throw new Error('lead or campaign missing');

  // Respect status/pause changes that happened after queuing.
  if (lead.paused) throw new Error('lead paused');
  if (action.action_type === 'send' && lead.status !== 'cold') throw new Error('lead no longer cold');

  let result;
  if (action.action_type === 'send') {
    result = await front.sendMessage({
      channelAddress: action.channel_address,
      to: lead.email,
      subject: action.subject,
      body: action.generated_body,
    });
    // Link the Front conversation on first send so its status shows in Front.
    if (!lead.front_conversation_id) {
      let cid = front.extractConversationId(result);
      if (!cid) { try { const c = await front.findConversationByEmail(lead.email); cid = c && c.id; } catch { /* ignore */ } }
      if (cid) {
        lead.front_conversation_id = cid;
        await supabase.from('leads').update({ front_conversation_id: cid }).eq('id', lead.id);
        front.syncStatusTag(cid, 'cold').catch(() => {});
      }
    }
  } else if (action.action_type === 'draft') {
    // Reply-aware: if no body was pre-generated, draft one from the live thread.
    let body = action.generated_body;
    if (!body && lead.front_conversation_id) {
      let threadText = '';
      try { threadText = await front.getThreadText(lead.front_conversation_id); } catch { /* ignore */ }
      const { data: settings } = await supabase.from('settings').select('key,value');
      const map = Object.fromEntries((settings || []).map((r) => [r.key, r.value]));
      try {
        const gen = await generateReply({
          kind: 'draft',
          campaign,
          lead,
          threadText,
          firstNames: [lead.first_name].filter(Boolean),
          styleGuide: campaign.style_guide,
          globalCorrections: map.global_style_corrections || '',
        });
        body = gen.body || '';
      } catch { body = `Hi ${lead.first_name || 'there'},\n\n`; }
      await supabase.from('scheduled_actions').update({ generated_body: body }).eq('id', action.id);
    }
    if (lead.front_conversation_id) {
      result = await front.createDraftReply({ conversationId: lead.front_conversation_id, body });
    } else {
      result = await front.createDraft({
        channelAddress: action.channel_address,
        to: lead.email,
        subject: action.subject || 'Following up',
        body,
      });
    }
  } else if (action.action_type === 'comment') {
    if (!lead.front_conversation_id) throw new Error('no conversation for comment');
    result = await front.createComment({
      conversationId: lead.front_conversation_id,
      body: action.generated_body,
    });
  }

  // Idempotency log (action_id is unique).
  await supabase.from('sent_log').insert({
    lead_id: lead.id,
    action_id: action.id,
    action_type: action.action_type,
    front_message_id: result?.id || null,
    front_conversation_id: lead.front_conversation_id || null,
  });

  await supabase.from('scheduled_actions')
    .update({ status: 'done', executed_at: new Date().toISOString() })
    .eq('id', action.id);

  // Advance cold sequence.
  if (action.action_type === 'send') {
    await supabase.from('leads').update({ sequence_step: action.step }).eq('id', lead.id);
    await enqueueNextColdEmail({ lead: { ...lead, sequence_step: action.step }, campaign, justSentStep: action.step });
  }
}

const _handler = async () => {
  const dueBefore = nowLocal().toUTC().toISO();
  const { data: due, error } = await supabase
    .from('scheduled_actions')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_for', dueBefore)
    .order('scheduled_for', { ascending: true })
    .limit(MAX_PER_RUN);

  if (error) return { statusCode: 500, body: error.message };

  let processed = 0, failed = 0;
  for (const action of due || []) {
    const claimed = await claim(action.id);
    if (!claimed) continue;
    try {
      await perform(claimed);
      processed += 1;
    } catch (e) {
      failed += 1;
      await supabase.from('scheduled_actions')
        .update({ status: 'pending', error: String(e.message).slice(0, 500) })
        .eq('id', action.id); // release for retry next run
    }
  }

  return { statusCode: 200, body: JSON.stringify({ processed, failed, considered: (due || []).length }) };
};

exports.handler = require('./_lib/core').safe(_handler);
