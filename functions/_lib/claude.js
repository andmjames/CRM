// Claude API client for generating outreach copy.
const MODEL = 'claude-sonnet-4-6';

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
async function generateColdFollowup({ campaign, lead, priorEmails, styleGuide, globalCorrections, stepNumber }) {
  const system = [
    'You write short, genuine B2B outreach follow-up emails for PMI Tape.',
    'Output ONLY valid JSON: {"subject": "...", "body": "..."} with no preamble or markdown.',
    'Vary the wording from previous emails — never repeat phrasing. Add a slightly new angle each time.',
    `Global style rules: ${globalCorrections || ''}`,
    `Campaign style guide: ${styleGuide || ''}`,
    `Product context: ${campaign.product_info || ''}`,
  ].join('\n');

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
    `Global style rules: ${globalCorrections || ''}`,
    `Campaign style guide: ${styleGuide || ''}`,
    `Product context: ${campaign.product_info || ''}`,
  ].join('\n');

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

module.exports = { generateColdFollowup, generateReply, MODEL };
