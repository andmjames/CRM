// Front API client (https://api2.frontapp.com).
// NOTE: written to the documented API; verify against your Front workspace on first
// live run (channel ids, author id, scopes: messages:send, drafts:write, comments).
const BASE = 'https://api2.frontapp.com';

function headers() {
  return {
    Authorization: `Bearer ${process.env.FRONT_API_TOKEN}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function frontFetch(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, { ...options, headers: headers() });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`Front ${res.status}: ${json?._error?.message || text}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

// Channels are addressed by alias: alt:address:<sender@domain>
function channelAlias(address) {
  return `alt:address:${encodeURIComponent(address)}`;
}

// Signature attachment. By default Front picks the channel/teammate default
// signature. Set FRONT_SIGNATURE_ID to force a specific one.
function signatureFields() {
  const id = process.env.FRONT_SIGNATURE_ID;
  return id ? { signature_id: id } : { should_add_default_signature: true };
}

// Front renders the message body as HTML and appends the signature (its own
// block, which carries a bit of leading space) right after. Convert the
// plain-text body to HTML and end with a single <br> so there's exactly one
// blank line before the signature.
function withSignatureGap(body) {
  const trimmed = String(body || '').replace(/\s+$/, '');
  const html = trimmed
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
  return `${html}<br>`;
}

// Send an outbound email from a channel (Cold leads). Creates + sends.
async function sendMessage({ channelAddress, to, subject, body }) {
  return frontFetch(`/channels/${channelAlias(channelAddress)}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      to: Array.isArray(to) ? to : [to],
      subject,
      body: withSignatureGap(body),   // plain text / HTML
      author_id: process.env.FRONT_AUTHOR_ID,
      ...signatureFields(),
      options: { archive: false },
    }),
  });
}

// Send a genuine REPLY into an existing conversation (threaded). Used for cold
// follow-ups so they land in the same email chain as the first email.
async function sendReply({ conversationId, channelAddress, to, subject, body }) {
  let channel_id = null;
  if (channelAddress) { try { channel_id = await channelIdByAddress(channelAddress); } catch { /* ignore */ } }
  return frontFetch(`/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      ...(channel_id ? { channel_id } : {}),
      ...(to ? { to: Array.isArray(to) ? to : [to] } : {}),
      ...(subject ? { subject } : {}),
      body: withSignatureGap(body),
      author_id: process.env.FRONT_AUTHOR_ID,
      ...signatureFields(),
      options: { archive: false },
    }),
  });
}

// Create a NEW-conversation draft from a channel (used when no thread exists yet).
async function createDraft({ channelAddress, to, subject, body }) {
  return frontFetch(`/channels/${channelAlias(channelAddress)}/drafts`, {
    method: 'POST',
    body: JSON.stringify({
      to: Array.isArray(to) ? to : [to],
      subject,
      body: withSignatureGap(body),
      author_id: process.env.FRONT_AUTHOR_ID,
      ...signatureFields(),
    }),
  });
}

// Channels list, cached per cold start. Used to resolve a channel_id from an address.
let _channelsCache = null;
async function listChannels() {
  if (_channelsCache) return _channelsCache;
  const json = await frontFetch('/channels');
  _channelsCache = json._results || [];
  return _channelsCache;
}
async function channelIdByAddress(address) {
  if (!address) return null;
  const lc = String(address).toLowerCase();
  const channels = await listChannels();
  const hit = channels.find((c) => String(c.address || '').toLowerCase() === lc
    || String(c.send_as || '').toLowerCase() === lc);
  if (!hit) {
    console.warn('front channelIdByAddress: no match for', address,
      '— available:', channels.map((c) => `${c.id}:${c.address || c.send_as || ''}`).join(', '));
  }
  return hit ? hit.id : null;
}

// Create a draft REPLY on an existing conversation (Dialogue leads). Not auto-sent.
// Front requires a channel_id to know which channel the reply sends from.
async function createDraftReply({ conversationId, channelAddress, body, to }) {
  let channel_id = null;
  if (channelAddress) { try { channel_id = await channelIdByAddress(channelAddress); } catch { /* ignore */ } }
  return frontFetch(`/conversations/${conversationId}/drafts`, {
    method: 'POST',
    body: JSON.stringify({
      ...(channel_id ? { channel_id } : {}),
      ...(to ? { to: Array.isArray(to) ? to : [to] } : {}),
      body: withSignatureGap(body),
      author_id: process.env.FRONT_AUTHOR_ID,
      ...signatureFields(),
    }),
  });
}

// Add an internal comment to a conversation (Current Customer leads). Sent immediately.
async function createComment({ conversationId, body }) {
  return frontFetch(`/conversations/${conversationId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ author_id: process.env.FRONT_AUTHOR_ID, body }),
  });
}

// Find the most recent conversation that involves a contact email.
async function findConversationByEmail(email) {
  const q = encodeURIComponent(`contact:${email}`);
  const json = await frontFetch(`/conversations/search/${q}`);
  return (json._results && json._results[0]) || null;
}

// --- Tags ---
let _tagCache = null;
async function listTags() {
  if (_tagCache) return _tagCache;
  const json = await frontFetch('/tags');
  _tagCache = json._results || [];
  return _tagCache;
}
async function tagIdByName(name) {
  const tags = await listTags();
  const t = tags.find((x) => (x.name || '').toLowerCase() === String(name).toLowerCase());
  return t ? t.id : null;
}
async function applyTag(conversationId, tagName) {
  const id = await tagIdByName(tagName);
  if (!id) return null;
  return frontFetch(`/conversations/${conversationId}/tags`, {
    method: 'POST', body: JSON.stringify({ tag_ids: [id] }),
  });
}
async function removeTag(conversationId, tagName) {
  const id = await tagIdByName(tagName);
  if (!id) return null;
  return frontFetch(`/conversations/${conversationId}/tags`, {
    method: 'DELETE', body: JSON.stringify({ tag_ids: [id] }),
  });
}

// Keep the Front conversation tagged with the lead's current status (one of the
// four), removing the others so the status is unambiguous when viewed in Front.
const STATUS_TAG_NAME = { cold: 'Cold', dialogue: 'Dialogue', current_customer: 'Current Customer', inactive: 'Inactive' };
async function syncStatusTag(conversationId, status) {
  const name = STATUS_TAG_NAME[status];
  if (!conversationId || !name) return;
  try { await applyTag(conversationId, name); } catch { /* ignore */ }
  for (const [k, n] of Object.entries(STATUS_TAG_NAME)) {
    if (k !== status) { try { await removeTag(conversationId, n); } catch { /* ignore */ } }
  }
}

// Pull a cnv_ id out of any Front API response (e.g. after sending a message).
function extractConversationId(result) {
  const m = JSON.stringify(result || '').match(/cnv_[A-Za-z0-9]+/);
  return m ? m[0] : null;
}

// --- Conversation context ---
async function getConversation(conversationId) {
  return frontFetch(`/conversations/${conversationId}`);
}
async function getMessages(conversationId) {
  const json = await frontFetch(`/conversations/${conversationId}/messages`);
  return json._results || [];
}
async function getComments(conversationId) {
  const json = await frontFetch(`/conversations/${conversationId}/comments`);
  return json._results || [];
}

// Which of our channels (account address) a conversation belongs to. Matches any
// message recipient/sender handle against our known channel addresses.
async function channelAddressForConversation(conversationId) {
  let msgs = [];
  try { msgs = await getMessages(conversationId); } catch { /* ignore */ }
  let channels = [];
  try { channels = await listChannels(); } catch { /* ignore */ }
  const known = new Map(channels.map((c) => [String(c.address || '').toLowerCase(), c.address]));
  for (const m of msgs) {
    for (const r of (m.recipients || [])) {
      const h = String(r.handle || '').toLowerCase();
      if (known.has(h)) return known.get(h);
    }
  }
  // Fallback: an inbound message's first 'to', else null.
  for (const m of msgs) {
    if (m.is_inbound) {
      const to = (m.recipients || []).find((r) => r.role === 'to');
      if (to?.handle) return to.handle;
    }
  }
  return null;
}
// Best-effort: pull readable text from the most recent inbound messages.
async function getThreadText(conversationId, limit = 3) {
  const msgs = await getMessages(conversationId);
  return msgs.slice(0, limit).map((m) => {
    const who = m.is_inbound ? 'Them' : 'Us';
    const body = (m.text || m.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return `${who}: ${body}`;
  }).reverse().join('\n');
}

module.exports = {
  sendMessage,
  sendReply,
  createDraft,
  createDraftReply,
  createComment,
  findConversationByEmail,
  listTags,
  applyTag,
  removeTag,
  syncStatusTag,
  extractConversationId,
  getConversation,
  getMessages,
  getComments,
  channelAddressForConversation,
  getThreadText,
};
