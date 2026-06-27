// front-webhook.js — receives Front RULE webhook events.
// Verifies X-Front-Signature (base64 HMAC-SHA1 of the raw body, keyed with the
// Webhooks app API Secret), then routes the event. Heavy AI work (reply drafts)
// is handed to the engine so this always acks within Front's 5s window.
const crypto = require('crypto');
const { supabase } = require('./_lib/supabase');
const { json } = require('./_lib/core');
const { generateCommandFromComment } = require('./_lib/claude');
const front = require('./_lib/front');

// Default §7a tag set (match these names when you create the tags in Front).
const STATUS_BY_TAG = {
  'cold': 'cold',
  'dialogue': 'dialogue',
  'current customer': 'current_customer',
  'inactive': 'inactive',
};
const EXCLUSIVE_TAGS = ['Cold', 'Dialogue', 'Current Customer', 'Inactive'];

function verify(rawBody, signature) {
  const secret = process.env.FRONT_WEBHOOK_SECRET;
  if (!secret) return true; // not configured yet — allow but you should set it
  try {
    const computed = crypto.createHmac('sha1', secret).update(rawBody, 'utf8').digest('base64');
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature || ''));
  } catch { return false; }
}

function looksAutomated(subject, body) {
  const s = `${subject || ''} ${String(body || '').slice(0, 200)}`.toLowerCase();
  return /out of office|automatic reply|auto-?reply|autoreply|vacation|away from (the )?office|do not reply|no-?reply|mailer-daemon|undeliverable|delivery (status|has failed)|returned to sender/.test(s);
}

// --- Defensive extractors (rule-webhook payload shapes vary by trigger) ---
function pick(obj, paths) {
  for (const p of paths) {
    const v = p.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
    if (v != null) return v;
  }
  return null;
}
function getType(p) {
  return (pick(p, ['type', 'event.type', 'payload.type']) || '').toLowerCase();
}
function getConversationId(p) {
  return pick(p, ['conversation.id', 'payload.conversation.id', 'target.data.conversation.id', 'conversation_reference']);
}
function getContactEmail(p) {
  // Try recipient handle, sender handle, or first contact handle.
  return pick(p, [
    'conversation.recipient.handle',
    'payload.conversation.recipient.handle',
    'target.data.recipient.handle',
    'target.data.author.handle',
    'source.data.0.handle',
  ]);
}
function getTagName(p) {
  return pick(p, ['target.data.name', 'tag.name', 'payload.tag.name', 'source.data.0.name']);
}
function getText(p) {
  return pick(p, ['target.data.body', 'target.data.text', 'payload.target.data.body', 'comment.body', 'message.body']);
}
function getSubject(p) {
  return pick(p, ['conversation.subject', 'target.data.subject', 'payload.conversation.subject']);
}

async function leadByEmail(email) {
  if (!email) return null;
  const { data } = await supabase.from('leads').select('*').ilike('email', String(email).toLowerCase()).maybeSingle();
  return data;
}

async function cancelPendingSends(leadId) {
  await supabase.from('scheduled_actions').update({ status: 'canceled' })
    .eq('lead_id', leadId).eq('action_type', 'send').eq('status', 'pending');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  const rawBody = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
  const sig = event.headers['x-front-signature'] || event.headers['X-Front-Signature'];
  if (!verify(rawBody, sig)) return json(401, { error: 'bad signature' });

  let payload;
  try { payload = JSON.parse(rawBody); } catch { return json(400, { error: 'bad json' }); }

  const type = getType(payload);
  const convId = getConversationId(payload);

  try {
    // ---- Tag added → status sync ----
    if (type === 'tag' || type === 'tagged' || type.includes('tag')) {
      const tagName = (getTagName(payload) || '').trim();
      const email = getContactEmail(payload);
      const lead = await leadByEmail(email);
      if (lead && tagName) {
        const lower = tagName.toLowerCase();
        if (STATUS_BY_TAG[lower]) {
          await supabase.from('leads').update({ status: STATUS_BY_TAG[lower] }).eq('id', lead.id);
          if (STATUS_BY_TAG[lower] !== 'cold') await cancelPendingSends(lead.id);
          // Keep the four status tags mutually exclusive in Front.
          if (convId) for (const t of EXCLUSIVE_TAGS) if (t.toLowerCase() !== lower) front.removeTag(convId, t).catch(() => {});
        } else if (lower === 'pause') {
          await supabase.from('leads').update({ paused: true }).eq('id', lead.id);
        } else if (lower === 'do not contact') {
          await supabase.from('leads').update({ status: 'inactive', paused: true }).eq('id', lead.id);
          await cancelPendingSends(lead.id);
          await supabase.from('suppression_list').upsert({ email: lead.email, reason: 'Do Not Contact (Front tag)' }, { onConflict: 'email' });
        }
      }
      return json(200, { ok: true, handled: 'tag' });
    }

    // ---- Comment → free-form Claude command ----
    if (type === 'comment') {
      const text = getText(payload);
      const email = getContactEmail(payload);
      const lead = await leadByEmail(email);
      if (lead && text) {
        const { data: campaign } = await supabase.from('campaigns').select('*').eq('id', lead.campaign_id).maybeSingle();
        let cmd;
        try { cmd = await generateCommandFromComment({ commentText: text, lead, campaign }); }
        catch { cmd = { action: 'none' }; }
        await applyCommand(cmd, lead);
      }
      return json(200, { ok: true, handled: 'comment' });
    }

    // ---- Inbound message → reply-aware ----
    if (type === 'inbound' || type === 'inbound_message' || type === 'message') {
      const email = getContactEmail(payload);
      const lead = await leadByEmail(email);
      if (lead) {
        const subject = getSubject(payload);
        const body = getText(payload);
        if (looksAutomated(subject, body)) {
          return json(200, { ok: true, handled: 'inbound:auto-reply ignored' });
        }
        // Genuine human reply: Cold → Dialogue, draft a response for review.
        const patch = { front_conversation_id: convId || lead.front_conversation_id };
        if (lead.status === 'cold') { patch.status = 'dialogue'; }
        await supabase.from('leads').update(patch).eq('id', lead.id);
        if (lead.status === 'cold') await cancelPendingSends(lead.id);

        // Queue a draft for the engine to generate with thread context.
        const { data: campaign } = await supabase.from('campaigns').select('front_channel_address').eq('id', lead.campaign_id).maybeSingle();
        await supabase.from('scheduled_actions').insert({
          lead_id: lead.id,
          campaign_id: lead.campaign_id,
          action_type: 'draft',
          step: 0,
          scheduled_for: new Date().toISOString(),
          channel_address: campaign?.front_channel_address || null,
          generated_body: '', // engine fills this in
        });
        // Fire-and-forget engine kick so the draft appears promptly.
        try {
          const base = process.env.URL || `https://${event.headers.host}`;
          fetch(`${base}/.netlify/functions/engine`).catch(() => {});
        } catch { /* ignore */ }
      }
      return json(200, { ok: true, handled: 'inbound' });
    }

    // ---- Bounce / delivery failure ----
    if (type.includes('bounce') || type.includes('sending_error') || type.includes('delivery')) {
      const email = getContactEmail(payload);
      const lead = await leadByEmail(email);
      if (lead) {
        await supabase.from('leads').update({ status: 'inactive' }).eq('id', lead.id);
        await cancelPendingSends(lead.id);
        await supabase.from('suppression_list').upsert({ email: lead.email, reason: 'bounced' }, { onConflict: 'email' });
        if (convId) front.applyTag(convId, 'Bounced').catch(() => {});
      }
      return json(200, { ok: true, handled: 'bounce' });
    }

    // Unknown event — log a trimmed sample so the payload shape can be tuned.
    console.log('front-webhook unhandled type:', type, JSON.stringify(payload).slice(0, 1500));
    return json(200, { ok: true, handled: 'ignored', type });
  } catch (e) {
    console.error('front-webhook error:', e.message, 'type:', type);
    // Return 200 so Front doesn't disable the webhook over a transient error.
    return json(200, { ok: false, error: e.message });
  }
};

async function applyCommand(cmd, lead) {
  switch (cmd.action) {
    case 'pause':
      await supabase.from('leads').update({ paused: true }).eq('id', lead.id);
      break;
    case 'resume':
      await supabase.from('leads').update({ paused: false }).eq('id', lead.id);
      break;
    case 'set_status':
      if (['cold', 'dialogue', 'current_customer', 'inactive'].includes(cmd.status)) {
        await supabase.from('leads').update({ status: cmd.status }).eq('id', lead.id);
        if (cmd.status !== 'cold') await cancelPendingSends(lead.id);
      }
      break;
    case 'stop':
      await supabase.from('leads').update({ status: 'inactive', paused: true }).eq('id', lead.id);
      await cancelPendingSends(lead.id);
      await supabase.from('suppression_list').upsert({ email: lead.email, reason: 'comment command: stop' }, { onConflict: 'email' });
      break;
    case 'note': {
      const note = (lead.notes ? lead.notes + '\n' : '') + (cmd.note || '');
      await supabase.from('leads').update({ notes: note }).eq('id', lead.id);
      break;
    }
    default:
      break;
  }
}
