// Claude API client for generating outreach copy.
const MODEL = 'claude-sonnet-4-6';

// Blanket directive that makes the user's global + channel instructions
// authoritative over the model's own writing habits, for every generator.
const INSTRUCTION_PRIORITY = 'The writing instructions below are absolute and override your own defaults for everything: tone, style, wording, greeting, sign-off, punctuation, formatting, and length. Wherever an instruction conflicts with how you would normally write, follow the instruction. Treat every instruction as a hard rule, not a suggestion.';

async function callClaude(system, userContent) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: userContent }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Claude ${res.status}: ${JSON.stringify(data)}`);
  return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

function parseJson(text) {
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

// Generate a cold follow-up (email 2+). Returns { subject, body }.
async function generateColdFollowup({ campaign, lead, priorEmails, styleGuide, globalCorrections, stepNumber, greeting }) {
  const system = [
    'You write short, genuine B2B outreach follow-up emails for PMI Tape.',
    'Output ONLY valid JSON: {"subject": "...", "body": "..."} with no preamble or markdown.',
    'Vary the wording from previous emails. Never repeat phrasing. Add a slightly new angle each time.',
    greeting ? `Begin the body with this exact greeting line: "${greeting} ${lead.first_name || 'there'},"` : '',
    (globalCorrections || styleGuide) ? INSTRUCTION_PRIORITY : '',
    globalCorrections ? `Global instructions: ${globalCorrections}` : '',
    styleGuide ? `Channel/campaign instructions: ${styleGuide}` : '',
    `Product context: ${campaign.product_info || ''}`,
  ].filter(Boolean).join('\n');

  const prior = (priorEmails || [])
    .map((e, i) => `--- Email ${i + 1} (subject: ${e.subject})\n${e.body}`)
    .join('\n\n');

  const user = [
    `Recipient first name: ${lead.first_name || 'there'}.`,
    `This is follow-up email #${stepNumber} in the sequence (the recipient has not replied).`,
    'Previous emails sent to this recipient:',
    prior || '(none)',
    'Write the next follow-up. Keep it brief and easy to reply to. Return JSON only.',
  ].join('\n');

  const text = await callClaude(system, user);
  return parseJson(text);
}

// Generate a reply-aware draft (Dialogue) or comment (Current Customer).
// Returns { body, suggested_wait_days }.
async function generateReply({ kind, campaign, lead, threadText, firstNames, styleGuide, globalCorrections }) {
  const isComment = kind === 'comment';
  const system = [
    isComment
      ? 'You write a short internal note suggesting how/when to follow up with an existing customer.'
      : 'You draft a short, warm reply email continuing an ongoing conversation for PMI Tape.',
    'Output ONLY valid JSON: {"body": "...", "suggested_wait_days": <integer>} with no markdown.',
    'A ~14 day wait is typical unless the thread implies otherwise.',
    (globalCorrections || styleGuide) ? INSTRUCTION_PRIORITY : '',
    globalCorrections ? `Global instructions: ${globalCorrections}` : '',
    styleGuide ? `Channel/campaign instructions: ${styleGuide}` : '',
    `Product context: ${campaign.product_info || ''}`,
  ].filter(Boolean).join('\n');

  const greet = firstNames && firstNames.length > 1
    ? `Greet all recipients by first name: ${firstNames.join(', ')}.`
    : `Recipient first name: ${(firstNames && firstNames[0]) || lead.first_name || 'there'}.`;

  const user = [
    greet,
    'Most recent message(s) in the thread:',
    threadText || '(no prior message text available)',
    isComment
      ? 'Suggest the follow-up note and a wait time. Return JSON only.'
      : 'Draft the reply and suggest a wait time before it should be sent. Return JSON only.',
  ].join('\n');

  const text = await callClaude(system, user);
  return parseJson(text);
}

// Interpret a free-form Front comment as a single structured action.
// Returns { action, status?, amount?, unit?, at?, note? }.
async function generateCommandFromComment({ commentText, lead, campaign, nowText }) {
  const system = [
    'You convert a short internal instruction (a Front comment, with the "@crm" mention removed) into ONE structured action.',
    'Output ONLY valid JSON, no markdown: {"action":"...","status":"...","amount":0,"unit":"...","at":"...","note":"..."}.',
    nowText ? `The current local time is ${nowText} (America/Indiana/Indianapolis). Use it to resolve absolute times.` : '',
    'Valid "action" values:',
    '- "remind": schedule a reminder. For a RELATIVE delay ("in 2 minutes", "in 3 days") set "amount" (number) and "unit" (one of "minutes","hours","days","weeks","months"). For an ABSOLUTE time ("tomorrow at 9am", "next Monday 2pm", "Friday morning") set "at" to a local datetime "YYYY-MM-DD HH:mm" (24-hour) computed from the current local time. Put a short reminder message in "note" (fold in any specifics).',
    '- "pause": pause scheduled emails (include "amount" and "unit").',
    '- "resume": unpause the lead.',
    '- "set_status": change status (include "status" = cold|dialogue|current_customer|inactive).',
    '- "stop": permanently stop contacting this lead (do not contact).',
    '- "note": just record the text as an internal note (include "note").',
    '- "none": no actionable instruction.',
    'Examples: "follow up in 2 minutes to make sure he likes it" -> {"action":"remind","amount":2,"unit":"minutes","note":"Follow up to make sure he likes it."}; "remind me to follow up tomorrow at 9am" -> {"action":"remind","at":"<tomorrow> 09:00","note":"Follow up."}. Include only relevant keys. If ambiguous, use "none".',
  ].filter(Boolean).join('\n');
  const user = [
    lead
      ? `Lead: ${lead.first_name || ''} ${lead.last_name || ''} <${lead.email}>, current status ${lead.status}, campaign ${campaign?.name || ''}.`
      : 'No matching lead in the CRM — this is a standalone reminder on a Front conversation. Only "remind" or "note" apply.',
    `Comment: "${commentText}"`,
    'Return the JSON action.',
  ].join('\n');
  const text = await callClaude(system, user);
  return parseJson(text);
}

// Extract reusable "how to respond" rules from ONE sent reply.
async function extractReplyRules({ subject, body }) {
  const system = [
    'You analyze one reply email a business owner sent to a customer or prospect, and extract reusable instructions for how they respond — the kind of guidance that would help an assistant draft replies in the same voice and with the same policies.',
    'Output ONLY a JSON array (no markdown), each item: {"category":"...","rule":"...","example":"..."}.',
    'category is one of: pricing, samples, lead_times, logistics, tone, general.',
    '"rule" is a concise, generalized imperative instruction (no names, companies, numbers, or one-off specifics) — something reusable across customers.',
    '"example" is a brief paraphrase of the situation it came from.',
    'Extract at most 3 rules. If the email is purely one-off with nothing reusable (or is itself cold outreach, not a response), return [].',
  ].join('\n');
  const user = `Subject: ${subject || ''}\n\nReply body:\n${(body || '').slice(0, 4000)}\n\nReturn the JSON array.`;
  const text = await callClaude(system, user);
  const parsed = parseJson(text);
  return Array.isArray(parsed) ? parsed : [];
}

// Merge a list of candidate rules into a clean, deduplicated canonical set.
async function consolidateRules(rules) {
  const system = [
    'You merge a list of candidate "how to respond to emails" rules into a deduplicated, canonical set.',
    'Combine near-duplicates into the single clearest phrasing and sum their support counts.',
    'Output ONLY a JSON array (no markdown), each item: {"category":"...","rule":"...","example":"...","support_count":<int>}.',
    'category is one of: pricing, samples, lead_times, logistics, tone, general. Keep rules concise and generalized.',
  ].join('\n');
  const user = `Candidate rules:\n${JSON.stringify(rules).slice(0, 12000)}\n\nReturn the merged JSON array.`;
  const text = await callClaude(system, user);
  const parsed = parseJson(text);
  return Array.isArray(parsed) ? parsed : [];
}

// Draft a reply to the latest message in a thread (for the "Draft AI Response"
// tag). Works on any conversation, lead or not. Returns the reply body only.
async function generateThreadReply({ threadText, playbook, signOff }) {
  const system = [
    'You draft a reply to the most recent email in this thread, on behalf of the business owner. The draft will be reviewed before sending. Never assume it is sent.',
    'Write ONLY the reply body: warm, concise, professional, and genuinely helpful. No subject line, no "Draft:" prefix, no meta commentary.',
    'Answer what was asked and move things forward. If you lack a specific fact (a price, a date), say you will follow up rather than inventing it.',
    playbook
      ? `${INSTRUCTION_PRIORITY}\n\nWriting instructions:\n${playbook}`
      : (signOff ? `End with a brief sign-off as ${signOff}.` : 'End with a brief, warm sign-off.'),
  ].filter(Boolean).join('\n');
  const user = `Email thread (oldest first, most recent last):\n${(threadText || '').slice(0, 8000)}\n\nWrite the reply body.`;
  return (await callClaude(system, user)).trim();
}

module.exports = { generateColdFollowup, generateReply, generateCommandFromComment, extractReplyRules, consolidateRules, generateThreadReply, MODEL };
