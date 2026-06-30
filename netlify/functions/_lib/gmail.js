// Gmail API client for the Reply Playbook miner.
// Uses a stored Google refresh token (offline access) so the miner can run
// from a cron without the browser open. Scope: gmail.readonly.
const { supabase } = require('./supabase');

const GMAIL = 'https://gmail.googleapis.com/gmail/v1';
const OAUTH = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

function redirectUri() {
  return process.env.GOOGLE_REDIRECT_URI
    || `${process.env.URL || 'https://pmileads.netlify.app'}/api/gmail-auth-callback`;
}

// URL the user clicks to grant read access (offline = returns a refresh token).
function consentUrl() {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

async function exchangeCode(code) {
  const res = await fetch(OAUTH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }).toString(),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`google token exchange: ${JSON.stringify(json)}`);
  return json; // { access_token, refresh_token, expires_in, ... }
}

async function profileEmail(accessToken) {
  const res = await fetch(`${GMAIL}/users/me/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json();
  return json.emailAddress || null;
}

// Persist tokens after the consent callback.
async function storeTokensFromCode(code) {
  const tok = await exchangeCode(code);
  const email = await profileEmail(tok.access_token);
  const expires_at = new Date(Date.now() + (tok.expires_in || 3600) * 1000).toISOString();
  await supabase.from('gmail_token_cache').upsert({
    account_email: email,
    refresh_token: tok.refresh_token, // present because prompt=consent + access_type=offline
    access_token: tok.access_token,
    expires_at,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'account_email' });
  return email;
}

// Return the most-recently-authed account row (single-mailbox assumption).
async function currentAccount() {
  const { data } = await supabase.from('gmail_token_cache')
    .select('*').order('updated_at', { ascending: false }).limit(1).maybeSingle();
  return data || null;
}

// Valid access token for the stored account, refreshing if needed.
async function getAccessToken() {
  const row = await currentAccount();
  if (!row) throw new Error('Gmail not connected — authorize first.');
  const fresh = row.access_token && row.expires_at && new Date(row.expires_at).getTime() > Date.now() + 60000;
  if (fresh) return { token: row.access_token, account: row.account_email };
  if (!row.refresh_token) throw new Error('No Gmail refresh token — re-authorize.');
  const res = await fetch(OAUTH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: row.refresh_token,
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      grant_type: 'refresh_token',
    }).toString(),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`google refresh: ${JSON.stringify(json)}`);
  const expires_at = new Date(Date.now() + (json.expires_in || 3600) * 1000).toISOString();
  await supabase.from('gmail_token_cache').update({
    access_token: json.access_token, expires_at, updated_at: new Date().toISOString(),
  }).eq('account_email', row.account_email);
  return { token: json.access_token, account: row.account_email };
}

async function gapi(path, token) {
  const res = await fetch(`${GMAIL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json();
  if (!res.ok) throw new Error(`gmail ${res.status}: ${json?.error?.message || JSON.stringify(json)}`);
  return json;
}

// One page of sent-message ids for a query.
async function listSent(token, query, pageToken) {
  const p = new URLSearchParams({ q: query, maxResults: '100' });
  if (pageToken) p.set('pageToken', pageToken);
  const json = await gapi(`/users/me/messages?${p.toString()}`, token);
  return { ids: (json.messages || []).map((m) => m.id), nextPageToken: json.nextPageToken || null };
}

function b64urlDecode(data) {
  try { return Buffer.from(String(data).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); }
  catch { return ''; }
}

// Walk the MIME tree for the best text body (prefer text/plain).
function extractBody(payload) {
  let plain = '', html = '';
  (function walk(part) {
    if (!part) return;
    const mt = part.mimeType || '';
    if (mt === 'text/plain' && part.body?.data) plain += b64urlDecode(part.body.data);
    else if (mt === 'text/html' && part.body?.data) html += b64urlDecode(part.body.data);
    (part.parts || []).forEach(walk);
  })(payload);
  let text = plain || html.replace(/<[^>]+>/g, ' ');
  return text;
}

// Drop quoted history so we keep what the sender actually wrote.
function stripQuoted(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (/^On .+wrote:$/.test(line.trim())) break;
    if (/^-{2,}\s*Original Message/i.test(line)) break;
    if (/^From:\s.+/i.test(line.trim()) && out.length > 2) break;
    if (line.trim().startsWith('>')) continue;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function header(headers, name) {
  const h = (headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

function domainsFrom(toValue) {
  const out = new Set();
  (toValue || '').split(',').forEach((addr) => {
    const m = addr.match(/@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/);
    if (m) out.add(m[1].toLowerCase());
  });
  return [...out];
}

// Full message → normalized record for mining.
async function getMessage(token, id) {
  const json = await gapi(`/users/me/messages/${id}?format=full`, token);
  const headers = json.payload?.headers || [];
  const subject = header(headers, 'Subject');
  const inReplyTo = header(headers, 'In-Reply-To');
  const dateMs = Number(json.internalDate) || Date.now();
  const bodyRaw = extractBody(json.payload);
  const body = stripQuoted(bodyRaw).slice(0, 6000);
  const isReply = !!inReplyTo || /^re:/i.test(subject || '');
  return {
    gmail_id: id,
    thread_id: json.threadId,
    sent_at: new Date(dateMs).toISOString(),
    subject,
    to_domains: domainsFrom(header(headers, 'To')),
    body_text: body,
    is_reply: isReply,
  };
}

module.exports = {
  consentUrl, storeTokensFromCode, getAccessToken, currentAccount,
  listSent, getMessage,
};
