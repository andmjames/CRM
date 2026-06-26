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

// Send an outbound email from a channel (Cold leads). Creates + sends.
async function sendMessage({ channelAddress, to, subject, body }) {
  return frontFetch(`/channels/${channelAlias(channelAddress)}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      to: Array.isArray(to) ? to : [to],
      subject,
      body,                 // plain text / HTML
      author_id: process.env.FRONT_AUTHOR_ID,
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
      body,
      author_id: process.env.FRONT_AUTHOR_ID,
    }),
  });
}

// Create a draft REPLY on an existing conversation (Dialogue leads). Not auto-sent.
async function createDraftReply({ conversationId, channelAddress, body, to }) {
  return frontFetch(`/conversations/${conversationId}/drafts`, {
    method: 'POST',
    body: JSON.stringify({
      channel_id: channelAddress ? undefined : undefined, // resolved by Front from convo
      to: to && (Array.isArray(to) ? to : [to]),
      body,
      author_id: process.env.FRONT_AUTHOR_ID,
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

module.exports = {
  sendMessage,
  createDraft,
  createDraftReply,
  createComment,
  findConversationByEmail,
};
