// front-webhook.js — receives Front RULE webhook events.
// Verifies X-Front-Signature (base64 HMAC-SHA1 of the raw body, keyed with the
// Webhooks app API Secret), then routes the event. Heavy AI work (reply drafts)
// is handed to the engine so this always acks within Front's 5s window.
const crypto = require('crypto');
const { supabase } = require('./_lib/supabase');
const { json, startDialogueDrafts } = require('./_lib/core');
const { generateCommandFromComment } = require('./_lib/claude');
const { nowLocal, DateTime, ZONE } = require('./_lib/schedule');
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

// Stop all automatic outreach for a lead — pending cold sends AND dialogue drafts.
// Leaves 'comment' actions (the @crm reminders) intact, so Current Customers keep
// their scheduled reminders while never being auto-emailed or auto-drafted.
async function cancelAutomation(leadId) {
  await supabase.from('scheduled_actions').update({ status: 'canceled' })
    .eq('lead_id', leadId).eq('status', 'pending').in('action_type', ['send', 'draft']);
}

// Rule webhooks nest fields differently than app webhooks and the recipient is
// only present with "Send Full Event Data" on — so search the whole payload.
function deepCollect(obj, test, acc = []) {
  if (obj == null) return acc;
  if (typeof obj === 'string') { if (test(obj)) acc.push(obj); return acc; }
  if (Array.isArray(obj)) { obj.forEach((v) => deepCollect(v, test, acc)); return acc; }
  if (typeof obj === 'object') { Object.keys(obj).forEach((k) => deepCollect(obj[k], test, acc)); return acc; }
  return acc;
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function findEmails(p) { return [...new Set(deepCollect(p, (s) => EMAIL_RE.test(s)).map((e) => e.toLowerCase()))]; }
function findConvIds(p) { return [...new Set(deepCollect(p, (s) => /^cnv_/.test(s)))]; }
function findTagNames(obj, acc = []) {
  if (Array.isArray(obj)) { obj.forEach((v) => findTagNames(v, acc)); }
  else if (obj && typeof obj === 'object') {
    if (typeof obj.id === 'string' && obj.id.startsWith('tag_') && typeof obj.name === 'string') acc.push(obj.name);
    Object.keys(obj).forEach((k) => findTagNames(obj[k], acc));
  }
  return acc;
}

// Resolve our lead from a set of candidate emails (case-insensitive). Channel /
// teammate emails simply won't match a lead, so this is safe.
async function leadByEmails(emails) {
  if (!emails || !emails.length) return null;
  const orFilter = emails.map((e) => `email.ilike.${e}`).join(',');
  const { data } = await supabase.from('leads').select('*').or(orFilter).limit(1);
  return (data && data[0]) || null;
}
async function leadByConv(cId) {
  if (!cId) return null;
  const { data } = await supabase.from('leads').select('*').eq('front_conversation_id', cId).limit(1);
  return (data && data[0]) || null;
}

// Most-advanced status tag wins if several are present during a transition.
const TAG_PRIORITY = ['do not contact', 'inactive', 'current customer', 'dialogue', 'cold'];

// Resolve our lead for an event: match any email in the payload, falling back to
// the conversation's recipient (via Front API) and then to a stored conv id.
async function resolveLead(payload, cId) {
  let emails = findEmails(payload);
  if (cId && process.env.FRONT_API_TOKEN) {
    try {
      const conv = await front.getConversation(cId);
      const recip = conv && conv.recipient && conv.recipient.handle;
      if (recip && EMAIL_RE.test(recip)) emails.push(recip.toLowerCase());
    } catch (e) { /* ignore */ }
  }
  emails = [...new Set(emails)];
  const lead = (await leadByEmails(emails)) || (await leadByConv(cId));
  return { lead, emails };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  const rawBody = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
  const sig = event.headers['x-front-signature'] || event.headers['X-Front-Signature'];
  console.log('front-webhook received: sig?', !!sig, 'len', rawBody.length);
  if (!verify(rawBody, sig)) { console.log('front-webhook REJECTED: bad signature'); return json(401, { error: 'bad signature' }); }

  let payload;
  try { payload = JSON.parse(rawBody); } catch { return json(400, { error: 'bad json' }); }

  const type = getType(payload);
  const convId = getConversationId(payload);
  console.log('front-webhook event type:', type || '(none)', 'conv:', convId || '(none)');

  try {
    // ---- Tag added/removed → status sync ----
    if (type.includes('tag')) {
      const cId = convId || findConvIds(payload)[0] || null;
      let emails = findEmails(payload);
      let tagNames = findTagNames(payload);

      // Authoritative lookup via the Front API: works even when "Send Full Event
      // Data" is off, and returns the conversation's real current tags + recipient.
      if (cId && process.env.FRONT_API_TOKEN) {
        try {
          const conv = await front.getConversation(cId);
          const recip = conv && conv.recipient && conv.recipient.handle;
          if (recip && EMAIL_RE.test(recip)) emails.push(recip.toLowerCase());
          const ctags = (conv && conv.tags ? conv.tags : []).map((t) => t.name).filter(Boolean);
          if (ctags.length) tagNames = ctags;
        } catch (e) { console.log('front-webhook getConversation failed:', e.message); }
      }
      emails = [...new Set(emails)];

      const lead = (await leadByEmails(emails)) || (await leadByConv(cId));
      const present = tagNames.map((t) => t.toLowerCase());
      console.log('front-webhook tag:', JSON.stringify({ cId, emails, tagNames, matched: lead ? lead.email : null }));

      // "Draft AI Response" tag → queue an AI draft reply on this conversation
      // (lead or not). The engine generates it using the rules for the channel's
      // account, creates the draft (never sends), and clears the tag.
      if (present.includes('draft ai response') && cId) {
        const { data: dup } = await supabase.from('scheduled_actions')
          .select('id').eq('front_conversation_id', cId).is('lead_id', null)
          .eq('action_type', 'draft').eq('status', 'pending').maybeSingle();
        if (!dup) {
          let label = 'Front conversation';
          try { const conv = await front.getConversation(cId); label = conv?.subject || conv?.recipient?.handle || label; } catch { /* ignore */ }
          await supabase.from('scheduled_actions').insert({
            action_type: 'draft', step: 0, status: 'pending',
            scheduled_for: new Date().toISOString(),
            front_conversation_id: cId, label, generated_body: '',
          });
          try {
            const base = process.env.URL || `https://${event.headers.host}`;
            await Promise.race([fetch(`${base}/.netlify/functions/engine`), new Promise((r) => setTimeout(r, 8000))]);
          } catch { /* cron backstop */ }
        }
        return json(200, { ok: true, handled: 'tag:draft-ai-response' });
      }

      if (lead) {
        if (present.includes('pause')) await supabase.from('leads').update({ paused: true }).eq('id', lead.id);
        let chosen = null;
        for (const t of TAG_PRIORITY) if (present.includes(t)) { chosen = t; break; }
        if (chosen === 'do not contact') {
          await supabase.from('leads').update({ status: 'inactive', paused: true, front_conversation_id: cId || lead.front_conversation_id }).eq('id', lead.id);
          await cancelAutomation(lead.id);
          await supabase.from('suppression_list').upsert({ email: lead.email, reason: 'Do Not Contact (Front tag)' }, { onConflict: 'email' });
        } else if (chosen && STATUS_BY_TAG[chosen]) {
          const newStatus = STATUS_BY_TAG[chosen];
          await supabase.from('leads').update({ status: newStatus, front_conversation_id: cId || lead.front_conversation_id }).eq('id', lead.id);
          // Current Customer / inactive: stop all auto sends AND drafts (reminders stay).
          if (newStatus === 'current_customer' || newStatus === 'inactive') await cancelAutomation(lead.id);
          else if (newStatus !== 'cold') await cancelPendingSends(lead.id);
        }
      }
      return json(200, { ok: true, handled: 'tag', matched: !!lead });
    }

    // ---- Comment → @crm command ----
    if (type === 'comment') {
      const cId = convId || findConvIds(payload)[0] || null;
      let text = getText(payload);
      // Fetch the comment body from Front if the payload didn't include it.
      if (!text && cId && process.env.FRONT_API_TOKEN) {
        try {
          const comments = await front.getComments(cId);
          text = comments.length ? (comments[comments.length - 1].body || '') : '';
        } catch { /* ignore */ }
      }
      // Only act on comments that explicitly mention @crm. This skips ordinary
      // internal notes and keeps the reminder comments (which contain no @crm)
      // from re-triggering this handler.
      if (!text || !/@crm\b/i.test(text)) {
        return json(200, { ok: true, handled: 'comment:no @crm' });
      }
      const { lead, emails } = await resolveLead(payload, cId);
      console.log('front-webhook comment:', JSON.stringify({ cId, emails, matched: lead ? lead.email : null }));
      const cleaned = text.replace(/@crm/ig, '').trim();
      const nowText = nowLocal().toFormat("yyyy-MM-dd HH:mm '('cccc')'");

      if (lead) {
        // Remember the conversation so scheduled reminders can post here later.
        if (cId && lead.front_conversation_id !== cId) {
          await supabase.from('leads').update({ front_conversation_id: cId }).eq('id', lead.id);
          lead.front_conversation_id = cId;
        }
        const { data: campaign } = await supabase.from('campaigns').select('*').eq('id', lead.campaign_id).maybeSingle();
        let cmd;
        try { cmd = await generateCommandFromComment({ commentText: cleaned, lead, campaign, nowText }); }
        catch { cmd = { action: 'none' }; }
        await applyCommand(cmd, lead, cId || lead.front_conversation_id);
        return json(200, { ok: true, handled: 'comment', matched: true });
      }

      // No matching lead: support a STANDALONE reminder on any conversation
      // (e.g. a vendor email). We never create a lead — just schedule the comment.
      if (cId) {
        let cmd;
        try { cmd = await generateCommandFromComment({ commentText: cleaned, lead: null, campaign: null, nowText }); }
        catch { cmd = { action: 'none' }; }
        if (cmd.action === 'remind') {
          let body = (cmd.note && String(cmd.note).trim()) || 'This is your reminder to follow up.';
          body = body.replace(/@crm/ig, '').trim();
          let label = 'Front conversation';
          try { const conv = await front.getConversation(cId); label = conv?.subject || conv?.recipient?.handle || label; } catch { /* ignore */ }
          await supabase.from('scheduled_actions').insert({
            action_type: 'comment', step: 0, status: 'pending',
            scheduled_for: remindWhen(cmd), generated_body: body,
            front_conversation_id: cId, label,
          });
          return json(200, { ok: true, handled: 'comment:standalone-reminder' });
        }
      }
      return json(200, { ok: true, handled: 'comment:no-lead', matched: false });
    }

    // ---- Inbound message → reply-aware ----
    if (type === 'inbound' || type === 'inbound_message' || type === 'message') {
      const cId = convId || findConvIds(payload)[0] || null;
      const { lead, emails } = await resolveLead(payload, cId);
      console.log('front-webhook inbound:', JSON.stringify({ cId, emails, matched: lead ? lead.email : null }));
      if (lead) {
        let subject = getSubject(payload);
        let body = getText(payload);
        // If the payload didn't include the message text (Full Event Data off),
        // pull it from Front so out-of-office / bounce detection still works.
        if (!subject && !body && cId && process.env.FRONT_API_TOKEN) {
          try { body = await front.getThreadText(cId, 1); } catch { /* ignore */ }
        }
        if (looksAutomated(subject, body)) {
          console.log('front-webhook inbound: auto-reply/bounce ignored');
          return json(200, { ok: true, handled: 'inbound:auto-reply ignored' });
        }
        // Genuine human reply: Cold → Dialogue, draft a response for review.
        const patch = { front_conversation_id: cId || lead.front_conversation_id };
        if (lead.status === 'cold') { patch.status = 'dialogue'; }
        await supabase.from('leads').update(patch).eq('id', lead.id);
        if (lead.status === 'cold') await cancelPendingSends(lead.id);
        if ((cId || lead.front_conversation_id) && patch.status) {
          try { await front.syncStatusTag(cId || lead.front_conversation_id, patch.status); } catch { /* ignore */ }
        }

        // Auto-draft only for Dialogue leads. Current Customers and inactive
        // leads never get automatic drafts — those are handled via @crm comments.
        const effectiveStatus = patch.status || lead.status;
        if (effectiveStatus === 'dialogue') {
          const { data: campaign } = await supabase.from('campaigns').select('id, front_channel_address, immediate_draft_response, dialogue_followup_weeks, dialogue_max_drafts').eq('id', lead.campaign_id).maybeSingle();
          if (campaign) await startDialogueDrafts({ lead: { ...lead, ...patch }, campaign });
          // Kick the engine so the immediate draft is created now. Await it (a
          // fire-and-forget call is killed when Netlify freezes the function),
          // but cap the wait so a backlog can't time out the Front webhook — the
          // engine invocation keeps running on its own and cron is the backstop.
          try {
            const base = process.env.URL || `https://${event.headers.host}`;
            await Promise.race([
              fetch(`${base}/.netlify/functions/engine`),
              new Promise((r) => setTimeout(r, 8000)),
            ]);
          } catch { /* cron will pick it up within 5 min */ }
        }
      }
      return json(200, { ok: true, handled: 'inbound' });
    }

    // ---- Bounce / delivery failure ----
    if (type.includes('bounce') || type.includes('sending_error') || type.includes('delivery')) {
      const cId = convId || findConvIds(payload)[0] || null;
      const { lead } = await resolveLead(payload, cId);
      if (lead) {
        await supabase.from('leads').update({ status: 'inactive' }).eq('id', lead.id);
        await cancelPendingSends(lead.id);
        await supabase.from('suppression_list').upsert({ email: lead.email, reason: 'bounced' }, { onConflict: 'email' });
        if (cId) { try { await front.applyTag(cId, 'Bounced'); } catch { /* ignore */ } try { await front.syncStatusTag(cId, 'inactive'); } catch { /* ignore */ } }
      }
      return json(200, { ok: true, handled: 'bounce', matched: !!lead });
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

// Convert a reminder delay (amount+unit, with day/minute fallbacks) to milliseconds.
function remindMs(cmd) {
  const UNIT_MS = { minutes: 60000, hours: 3600000, days: 86400000, weeks: 604800000, months: 2592000000 };
  const amount = Number(cmd.amount);
  if (amount > 0 && cmd.unit && UNIT_MS[cmd.unit]) return amount * UNIT_MS[cmd.unit];
  if (Number(cmd.days) > 0) return Number(cmd.days) * UNIT_MS.days;       // backward compatible
  if (Number(cmd.minutes) > 0) return Number(cmd.minutes) * UNIT_MS.minutes;
  return 14 * UNIT_MS.days; // default: 2 weeks
}

// Resolve a reminder's fire time to a UTC ISO string. Supports an absolute local
// datetime ("YYYY-MM-DD HH:mm" in Indianapolis) or a relative amount+unit delay.
function remindWhen(cmd) {
  if (cmd.at) {
    const raw = String(cmd.at).trim().replace('T', ' ').slice(0, 16);
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(raw)) {
      const dt = DateTime.fromFormat(raw, 'yyyy-MM-dd HH:mm', { zone: ZONE });
      if (dt.isValid && dt.toMillis() > Date.now()) return dt.toUTC().toISO();
    }
  }
  return new Date(Date.now() + remindMs(cmd)).toISOString();
}

async function applyCommand(cmd, lead, cId) {
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
        if (cmd.status === 'current_customer' || cmd.status === 'inactive') await cancelAutomation(lead.id);
        else if (cmd.status !== 'cold') await cancelPendingSends(lead.id);
        if (cId) { try { await front.syncStatusTag(cId, cmd.status); } catch { /* ignore */ } }
      }
      break;
    case 'stop':
      await supabase.from('leads').update({ status: 'inactive', paused: true }).eq('id', lead.id);
      await cancelAutomation(lead.id);
      await supabase.from('suppression_list').upsert({ email: lead.email, reason: 'comment command: stop' }, { onConflict: 'email' });
      if (cId) { try { await front.syncStatusTag(cId, 'inactive'); } catch { /* ignore */ } }
      break;
    case 'remind': {
      const when = remindWhen(cmd);
      let body = (cmd.note && String(cmd.note).trim()) || 'This is your reminder to follow up.';
      body = body.replace(/@crm/ig, '').trim(); // never echo the trigger (avoids re-firing)
      await supabase.from('scheduled_actions').insert({
        lead_id: lead.id,
        campaign_id: lead.campaign_id,
        action_type: 'comment',
        step: 0,
        scheduled_for: when,
        channel_address: null,
        generated_body: body,
      });
      break;
    }
    case 'note': {
      const note = (lead.notes ? lead.notes + '\n' : '') + (cmd.note || '');
      await supabase.from('leads').update({ notes: note }).eq('id', lead.id);
      break;
    }
    default:
      break;
  }
}
